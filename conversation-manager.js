/**
 * VoxFill - conversation-manager.js
 *
 * The orchestrator: scans the form, announces what it found, asks the user
 * for each field one at a time, parses the answer according to field type,
 * fills it in, and supports voice commands ("what is left", "repeat",
 * "change my name", "skip this field", "read filled details",
 * "stop listening"). Ends with a spoken summary and confirmation - it never
 * submits the form itself.
 */
(function () {
  const VF = (window.VoxFill = window.VoxFill || {});

  const state = {
  fields: [],
  currentIndex: 0,
  active: false,

  languageMode: 'english',
  speechLanguage: 'en-IN',
};

  // ---------- Speech-to-value parsing helpers ----------

  const WORD_DIGITS = {
    zero: '0',
    oh: '0',
    one: '1',
    two: '2',
    to: '2',
    too: '2',
    three: '3',
    four: '4',
    for: '4',
    five: '5',
    six: '6',
    seven: '7',
    eight: '8',
    nine: '9',
  };
  async function askPreferredLanguage() {
  await VF.voice.setLanguage('en-IN');

  await VF.voice.speak(
    'Which language are you comfortable with? konse language me baat krna h ' +
    'Say English, Hindi'
  );

  VF.ui.setStatus('Select language: English, Hindi');

  let transcript;

  try {
    transcript = await VF.voice.listenOnce(10000);
  } catch (error) {
    await VF.voice.speak(
      'I could not hear the language. English will be selected.'
    );

    state.languageMode = 'english';
    state.speechLanguage = 'en-IN';
    await VF.voice.setLanguage('en-IN');
    return;
  }

  const answer = transcript.toLowerCase();

  if (
    answer.includes('hindi') ||
    answer.includes('हिंदी')
  ) {
    state.languageMode = 'hindi';
    state.speechLanguage = 'en-IN';

    await VF.voice.setLanguage('en-IN');
    await VF.voice.speak('ठीक है। अब हम हिंदी में बात करेंगे।');
  } else if (
    answer.includes('hinglish') ||
    answer.includes('हिंग्लिश')
  ) {
    state.languageMode = 'hinglish';
    state.speechLanguage = 'en-IN';

    await VF.voice.setLanguage('en-IN');
    await VF.voice.speak(
      'Theek hai. Ab hum Hinglish mein baat karenge.'
    );
  } else {
    state.languageMode = 'english';
    state.speechLanguage = 'en-IN';

    await VF.voice.setLanguage('en-IN');
    await VF.voice.speak(
      'Okay. We will continue in English.'
    );
  }

  VF.ui.log(`Selected language: ${state.languageMode}`);
}
  function wordsToDigits(text) {
    const tokens = text
      .toLowerCase()
      .replace(/[^a-z0-9\s+]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    let out = '';
    tokens.forEach((tok) => {
      if (/^\d+$/.test(tok)) {
        out += tok;
        return;
      }
      if (tok === 'plus') {
        out += '+';
        return;
      }
      if (Object.prototype.hasOwnProperty.call(WORD_DIGITS, tok)) {
        out += WORD_DIGITS[tok];
      }
    });
    return out;
  }

  function spokenToEmail(text) {
  let t = ' ' + text.toLowerCase().trim() + ' ';

   t=t
    // "at the rate", "at the rate of", aur "at" ko @ banayega
    .replace(/\s+at\s+the\s+rate\s+of\s+/g, '@')
    .replace(/\s+at\s+the\s+rate\s+/g, '@')
    .replace(/\s+at\s+/g, '@')

    // Dot ke different spoken forms
    .replace(/\s+dot\s+/g, '.')
    .replace(/\s+point\s+/g, '.')

    // Other symbols
    .replace(/\s+underscore\s+/g, '_')
    .replace(/\s+(dash|hyphen)\s+/g, '-')

    // Remaining spaces remove karega
    .replace(/\s+/g, '');

  return t;
}

  const MONTHS = [
    'january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december',
  ];

  function toIso(y, m, d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${y}-${pad(m)}-${pad(d)}`;
  }

  function parseSpokenDate(text) {
    const t = text.toLowerCase().trim();

    let m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) return toIso(m[1], m[2], m[3]);

    m = t.match(/(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/);
    if (m) {
      const year = m[3].length === 2 ? '20' + m[3] : m[3];
      return toIso(year, m[1], m[2]);
    }

    const monthPattern = MONTHS.join('|');
    m = t.match(new RegExp(`(\\d{1,2})(st|nd|rd|th)?\\s+(?:of\\s+)?(${monthPattern})\\s+(\\d{4})`));
    if (m) {
      const day = m[1];
      const month = MONTHS.indexOf(m[3]) + 1;
      const year = m[4];
      return toIso(year, month, day);
    }

    m = t.match(new RegExp(`(${monthPattern})\\s+(\\d{1,2})(st|nd|rd|th)?,?\\s+(\\d{4})`));
    if (m) {
      const month = MONTHS.indexOf(m[1]) + 1;
      const day = m[2];
      const year = m[4];
      return toIso(year, month, day);
    }

    const d = new Date(text);
    if (!isNaN(d.getTime())) {
      return toIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
    return null;
  }

  function normalizeAnswer(field, transcript) {
  switch (field.type) {
    case 'email':
      return spokenToEmail(transcript);

    case 'tel': {
      const digits = wordsToDigits(transcript);
      return digits || transcript.replace(/\s+/g, '');
    }

    case 'date': {
      const iso = parseSpokenDate(transcript);
      return iso || transcript;
    }

    default:
      return transcript.trim();
  }
}

  // ---------- Voice command detection ----------

  function detectCommand(transcript) {
    const t = transcript.toLowerCase().trim();
    if (/what('?s| is) left|remaining fields|what remains/.test(t)) return { type: 'what-is-left' };
    if (/^repeat|say (that|it) again|repeat (that|please|the question)/.test(t)) return { type: 'repeat' };
    if (/^(skip|skip this field|skip it|next field)/.test(t)) return { type: 'skip' };
    if (/read (filled|my) (details|answers|information)|read back|read summary/.test(t)) {
      return { type: 'read-filled' };
    }
    if (/^stop listening|stop the assistant|cancel assistant|stop voxfill/.test(t)) return { type: 'stop' };
    const changeMatch = t.match(/^change (?:my |the )?(.+)/);
    if (changeMatch) return { type: 'change', target: changeMatch[1] };
    return null;
  }

  function fuzzyFindFieldIndex(query) {
    const norm = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
    const target = norm(query);
    let best = -1;
    let bestScore = 0;
    state.fields.forEach((f, i) => {
      const label = norm(f.label);
      let score = 0;
      if (label === target) {
        score = 100;
      } else if (label.includes(target) || target.includes(label)) {
        score = 60;
      } else {
        const wordsA = new Set(label.split(' '));
        const wordsB = target.split(' ');
        score = wordsB.filter((w) => wordsA.has(w)).length * 10;
      }
      if (score > bestScore) {
        bestScore = score;
        best = i;
      }
    });
    return bestScore > 0 ? best : -1;
  }

  // ---------- Questions ----------

  function fieldQuestion(field) {
  const label = field.label;

  if (state.languageMode === 'hindi') {
    if (
      field.type === 'select' ||
      field.type === 'select-multiple' ||
      field.type === 'radio'
    ) {
      const options = field.options
        .map((option) => option.text)
        .filter(Boolean)
        .join(', ');

      return `${label} के लिए विकल्प हैं: ${options}। कृपया अपना विकल्प बताइए।`;
    }

    if (field.type === 'checkbox') {
      return `क्या आप ${label} चुनना चाहते हैं? कृपया हाँ या नहीं बोलिए।`;
    }

    if (field.type === 'checkbox-group') {
      const options = field.options
        .map((option) => option.text)
        .filter(Boolean)
        .join(', ');

      return `${label} के लिए आप इनमें से विकल्प चुन सकते हैं: ${options}।`;
    }

    if (field.type === 'date') {
      return `कृपया अपनी ${label} बताइए।`;
    }

    if (field.type === 'email') {
      return `कृपया अपना ${label} बताइए। उदाहरण के लिए anushka at gmail dot com।`;
    }

    if (field.type === 'tel') {
      return `कृपया अपना ${label} एक-एक अंक करके बताइए।`;
    }

    return `कृपया अपना ${label} बताइए।`;
  }

  if (state.languageMode === 'hinglish') {
    if (
      field.type === 'select' ||
      field.type === 'select-multiple' ||
      field.type === 'radio'
    ) {
      const options = field.options
        .map((option) => option.text)
        .filter(Boolean)
        .join(', ');

      return `${label} ke options hain: ${options}. Please apna option boliye.`;
    }

    if (field.type === 'checkbox') {
      return `Kya aap ${label} select karna chahte hain? Please yes ya no boliye.`;
    }

    if (field.type === 'checkbox-group') {
      const options = field.options
        .map((option) => option.text)
        .filter(Boolean)
        .join(', ');

      return `${label} ke liye aap ye options choose kar sakte hain: ${options}.`;
    }

    if (field.type === 'date') {
      return `Please apni ${label} batayein.`;
    }

    if (field.type === 'email') {
      return `Please apna ${label} batayein. Example, anushka at gmail dot com.`;
    }

    if (field.type === 'tel') {
      return `Please apna ${label} digit by digit boliye.`;
    }

    return `Please apna ${label} batayein.`;
  }

  // English

  if (
    field.type === 'select' ||
    field.type === 'select-multiple' ||
    field.type === 'radio'
  ) {
    const options = field.options
      .map((option) => option.text)
      .filter(Boolean)
      .join(', ');

    return `For ${label}, your options are: ${options}. Please say your choice.`;
  }

  if (field.type === 'checkbox') {
    return `Do you want to select ${label}? Please say yes or no.`;
  }

  if (field.type === 'checkbox-group') {
    const options = field.options
      .map((option) => option.text)
      .filter(Boolean)
      .join(', ');

    return `For ${label}, you may choose one or more of: ${options}.`;
  }

  if (field.type === 'date') {
    return `Please say your ${label}.`;
  }

  if (field.type === 'email') {
    return `Please say your ${label}. For example, anushka at gmail dot com.`;
  }

  if (field.type === 'tel') {
    return `Please say your ${label}, digit by digit.`;
  }

  return `Please provide your ${label}.`;
}
  // ---------- Flow control ----------

  function remainingRequiredFields() {
    return state.fields.filter((f) => f.required && !f.filled);
  }

  function firstUnfilledIndex() {
    for (let i = 0; i < state.fields.length; i++) {
      if (!state.fields[i].filled) return i;
    }
    return -1;
  }

  function findNextIndex(fromIndex) {
    for (let i = fromIndex + 1; i < state.fields.length; i++) {
      if (!state.fields[i].filled) return i;
    }
    for (let i = 0; i < state.fields.length; i++) {
      if (!state.fields[i].filled) return i;
    }
    return state.fields.length;
  }

  async function announceOverview() {
  const count = state.fields.length;

  if (state.languageMode === 'hindi') {
    await VF.voice.speak(
      `इस फॉर्म में ${count} फ़ील्ड हैं। चलिए शुरू करते हैं।`
    );
  } else if (state.languageMode === 'hinglish') {
    await VF.voice.speak(
      `Is form mein ${count} fields hain. Chaliye start karte hain.`
    );
  } else {
    await VF.voice.speak(
      `I found ${count} fields. Let's begin.`
    );
  }

  VF.ui.setStatus(`Found ${count} fields.`);
}

  async function askCurrentField() {
    if (!state.active) return;
    const field = state.fields[state.currentIndex];
    if (!field) {
      await moveToConfirmation();
      return;
    }
    VF.ui.setStatus(`Asking: ${field.label}`);
    await VF.voice.speak(fieldQuestion(field));
    await listenForAnswer();
  }

  async function listenForAnswer() {
    if (!state.active) return;
    let transcript;
    try {
      transcript = await VF.voice.listenOnce(9000);
    } catch (e) {
      if (!state.active) return;
      await VF.voice.speak("Sorry, I didn't catch that. Let's try again.");
      await askCurrentField();
      return;
    }
    VF.ui.log('You said: ' + transcript);

    const command = detectCommand(transcript);
    if (command) {
      await handleCommand(command);
      return;
    }
    await handleAnswer(transcript);
  }

  async function handleCommand(command) {
    if (!state.active) return;
    switch (command.type) {
      case 'what-is-left': {
        const remaining = remainingRequiredFields();
        if (remaining.length === 0) {
          await VF.voice.speak('All required fields are filled.');
        } else {
          await VF.voice.speak(`Fields left: ${remaining.map((f) => f.label).join(', ')}.`);
        }
        await askCurrentField();
        return;
      }
      case 'repeat': {
        await askCurrentField();
        return;
      }
      case 'skip': {
        const field = state.fields[state.currentIndex];
        if (field.required) {
          await VF.voice.speak(`${field.label} is required, but I will skip it for now. You can fill it later.`);
        } else {
          await VF.voice.speak(`Skipped ${field.label}.`);
        }
        state.currentIndex = findNextIndex(state.currentIndex);
        await proceed();
        return;
      }
      case 'read-filled': {
        const filled = state.fields.filter((f) => f.filled);
        if (filled.length === 0) {
          await VF.voice.speak('No fields have been filled yet.');
        } else {
          const text = filled.map((f) => `${f.label}: ${f.value}`).join('. ');
          await VF.voice.speak(`Here is what you have filled so far. ${text}`);
        }
        await askCurrentField();
        return;
      }
      case 'change': {
        const idx = fuzzyFindFieldIndex(command.target);
        if (idx === -1) {
          await VF.voice.speak(`I could not find a field matching ${command.target}. Please repeat.`);
          await askCurrentField();
        } else {
          state.currentIndex = idx;
          state.fields[idx].filled = false;
          await VF.voice.speak(`Okay, let's update ${state.fields[idx].label}.`);
          await askCurrentField();
        }
        return;
      }
      case 'stop': {
        await stop('Stopping voice assistant. You can restart anytime.');
        return;
      }
      default:
        await askCurrentField();
    }
  }

  async function handleAnswer(rawTranscript) {
    const field = state.fields[state.currentIndex];
    const normalized = normalizeAnswer(field, rawTranscript);
    const result = VF.filler.fill(field, normalized);

    if (!result || result.ok === false) {
      await VF.voice.speak(`I could not match that to an option for ${field.label}. Let's try again.`);
      await askCurrentField();
      return;
    }

    VF.ui.log(`Filled ${field.label}: ${field.value}`);
    await VF.voice.speak(`Got it. ${field.label} set.`);
    state.currentIndex = findNextIndex(state.currentIndex);
    await proceed();
  }

  async function proceed() {
    if (!state.active) return;
    if (state.currentIndex >= state.fields.length || state.fields.every((f) => f.filled)) {
      await moveToConfirmation();
      return;
    }
    await askCurrentField();
  }

  async function moveToConfirmation() {
    if (!state.active) return;
    const filled = state.fields.filter((f) => f.filled);
    const unfilled = state.fields.filter((f) => !f.filled);
    let summary = filled.map((f) => `${f.label}: ${f.value}`).join('. ');
    if (!summary) summary = 'No fields have been filled';
    let msg = `Here is a summary of your answers. ${summary}.`;
    if (unfilled.length) {
      msg += ` The following fields are still empty: ${unfilled.map((f) => f.label).join(', ')}.`;
    }
    msg +=
      ' I will not submit the form automatically. Say "yes" when you are ready to review and submit yourself, "no" to keep editing, or name a field to change.';
    VF.ui.setStatus('Awaiting confirmation.');
    await VF.voice.speak(msg);
    await listenForConfirmation();
  }

  async function listenForConfirmation() {
    if (!state.active) return;
    let transcript;
    try {
      transcript = await VF.voice.listenOnce(9000);
    } catch (e) {
      if (!state.active) return;
      await VF.voice.speak("I didn't hear you. Say yes to finish, or no to keep editing.");
      await listenForConfirmation();
      return;
    }
    VF.ui.log('You said: ' + transcript);
    const t = transcript.toLowerCase();
    const command = detectCommand(transcript);

    if (command && command.type === 'change') {
      const idx = fuzzyFindFieldIndex(command.target);
      if (idx !== -1) {
        state.currentIndex = idx;
        state.fields[idx].filled = false;
        await VF.voice.speak(`Okay, let's update ${state.fields[idx].label}.`);
        await askCurrentField();
        return;
      }
    }
    if (command && command.type === 'read-filled') {
      const filled = state.fields.filter((f) => f.filled);
      const text = filled.length
        ? filled.map((f) => `${f.label}: ${f.value}`).join('. ')
        : 'No fields have been filled yet.';
      await VF.voice.speak(text);
      await listenForConfirmation();
      return;
    }
    if (command && command.type === 'stop') {
      await stop('Stopping voice assistant.');
      return;
    }

    if (/\b(yes|yeah|correct|ready|done|sure|confirm)\b/.test(t)) {
      await VF.voice.speak(
        'The form is filled. Please review the details on screen and press submit yourself when ready. VoxFill will never submit for you.'
      );
      state.active = false;
      VF.ui.setStatus('Ready for manual review and submission.');
      VF.ui.notifyDone();
      return;
    }
    if (/\b(no|not yet|wait)\b/.test(t)) {
      const idx = firstUnfilledIndex();
      if (idx === -1) {
        await VF.voice.speak(
          'All fields are filled. Say the name of a field if you want to change it, or say yes to finish.'
        );
        await listenForConfirmation();
      } else {
        state.currentIndex = idx;
        await askCurrentField();
      }
      return;
    }

    await VF.voice.speak('Sorry, please say yes, no, or the name of a field you want to change.');
    await listenForConfirmation();
  }

  async function stop(message) {
    state.active = false;
    VF.voice.stopListening();
    VF.voice.cancelSpeech();
    if (message) await VF.voice.speak(message);
    VF.ui.setStatus('Stopped.');
    VF.ui.notifyDone();
  }

  async function start() {
  if (!VF.voice.isSupported()) {
    VF.ui.setStatus('Speech recognition is not supported in this browser.');

    await VF.voice.speak(
      'Sorry, this browser does not support speech recognition. Please try Google Chrome.'
    );

    VF.ui.notifyDone();
    return;
  }

  // Session ko active karo
  state.active = true;

  // Sabse pehle user se language pucho
  await askPreferredLanguage();

  // Agar user ne assistant stop kar diya ho
  if (!state.active) return;

  // Language select hone ke baad form scan karo
  state.fields = VF.scanner.scan();
  state.currentIndex = 0;

  if (state.fields.length === 0) {
    await VF.voice.speak(
      'I could not find any fillable form fields on this page.'
    );

    VF.ui.setStatus('No fields found.');
    state.active = false;
    VF.ui.notifyDone();
    return;
  }

  VF.ui.setStatus(
    `Scanning complete. ${state.fields.length} field(s) found.`
  );

  await announceOverview();

  if (!state.active) return;

  state.currentIndex = firstUnfilledIndex();
  await proceed();
}

VF.conversation = {
  start,
  stop,
  getState: () => state
};
})();