/**
 * VoxFill - voice-engine.js
 *
 * Thin wrapper around the Web Speech APIs:
 *  - webkitSpeechRecognition / SpeechRecognition for voice input
 *  - speechSynthesis for voice output
 *
 * Exposes a small promise-based API used by conversation-manager.js.
 */
(function () {
  const VF = (window.VoxFill = window.VoxFill || {});

  const SpeechRecognitionImpl = window.SpeechRecognition || window.webkitSpeechRecognition;

  let recognition = null;
  let listening = false;

  function isSupported() {
    return !!SpeechRecognitionImpl && 'speechSynthesis' in window;
  }

  function createRecognition() {
    const r = new SpeechRecognitionImpl();
    r.lang = 'en-US';
    r.continuous = false;
    r.interimResults = false;
    r.maxAlternatives = 1;
    return r;
  }

  /**
   * Listens for a single spoken utterance and resolves with the transcript.
   * Rejects with an Error on timeout, no speech, or a recognition error.
   */
  function listenOnce(timeoutMs) {
    timeoutMs = timeoutMs || 9000;
    return new Promise((resolve, reject) => {
      if (!SpeechRecognitionImpl) {
        reject(new Error('speech-recognition-unsupported'));
        return;
      }

      recognition = createRecognition();
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          recognition.stop();
        } catch (e) {
          /* ignore */
        }
        reject(new Error('timeout'));
      }, timeoutMs);

      recognition.onresult = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const transcript = event.results[0][0].transcript.trim();
        resolve(transcript);
      };

      recognition.onerror = (event) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(event.error || 'recognition-error'));
      };

      recognition.onend = () => {
        listening = false;
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error('no-speech'));
        }
      };

      try {
        listening = true;
        recognition.start();
      } catch (e) {
        settled = true;
        clearTimeout(timer);
        reject(e);
      }
    });
  }

  function stopListening() {
    if (recognition && listening) {
      try {
        recognition.stop();
      } catch (e) {
        /* ignore */
      }
    }
    listening = false;
  }

  /** Speaks text aloud, resolving once speech has finished. */
  function speak(text, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window) || !text) {
        resolve();
        return;
      }
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = opts.rate || 1;
      utter.pitch = opts.pitch || 1;
      utter.lang = 'en-US';
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      window.speechSynthesis.speak(utter);
    });
  }

  function cancelSpeech() {
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  }

  VF.voice = { isSupported, listenOnce, stopListening, speak, cancelSpeech };
})();
