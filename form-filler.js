/**
 * VoxFill - form-filler.js
 *
 * Takes a field descriptor (from form-scanner.js) and a value derived from
 * speech, and writes it into the actual DOM element(s), using the native
 * property setter (so frameworks like React that wrap value with their own
 * setter still detect the change) and dispatching 'input'/'change' events.
 */
(function () {
  const VF= (window.VoxFill = window.VoxFill || {});
 
  function nativeSetValue(el, value) {
    const proto =
      el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, value);
    } else {
      el.value = value;
    }
  }
 
  function dispatchEvents(el, extraTypes) {
    const types = ['input', 'change'].concat(extraTypes || []);
    types.forEach((type) => {
      el.dispatchEvent(new Event(type, { bubbles: true }));
    });
  }
 
  function normalizeMatchText(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
  }
 
  function matchOption(options, spokenValue) {
    const target = normalizeMatchText(spokenValue);
    if (!target) return null;
 
    let found = options.find(
      (o) => normalizeMatchText(o.text) === target || normalizeMatchText(o.value) === target
    );
    if (found) return found;
 
    found = options.find(
      (o) => normalizeMatchText(o.text).includes(target) || target.includes(normalizeMatchText(o.text))
    );
    if (found) return found;
 
    // word-overlap fallback
    const targetWords = new Set(target.split(' '));
    let best = null;
    let bestScore = 0;
    options.forEach((o) => {
      const words = normalizeMatchText(o.text).split(' ');
      const score = words.filter((w) => targetWords.has(w)).length;
      if (score > bestScore) {
        bestScore = score;
        best = o;
      }
    });
    return bestScore > 0 ? best : null;
  }
 
  function fillTextLike(field, value) {
    const el = field.elements[0];
    nativeSetValue(el, value);
    dispatchEvents(el);
    field.value = value;
    field.filled = true;
    return { ok: true };
  }
 
  function fillSelect(field, spokenValue) {
    const el = field.elements[0];
    const match = matchOption(field.options, spokenValue);
    if (!match) return { ok: false };
    el.value = match.value;
    dispatchEvents(el);
    field.value = match.text;
    field.filled = true;
    return { ok: true, matched: match.text };
  }
 
  function fillRadio(field, spokenValue) {
    const match = matchOption(field.options, spokenValue);
    if (!match) return { ok: false };
    match.element.checked = true;
    dispatchEvents(match.element, ['click']);
    field.value = match.text;
    field.filled = true;
    return { ok: true, matched: match.text };
  }
 
  function fillCheckbox(field, spokenValue) {
    const affirmative = /\b(yes|yeah|yep|sure|correct|true|check|checked|agree|do)\b/i.test(spokenValue);
    const negative = /\b(no|nope|not|false|uncheck|unchecked|disagree|don't|dont)\b/i.test(spokenValue);
    const el = field.elements[0];
    if (negative) {
      el.checked = false;
    } else if (affirmative) {
      el.checked = true;
    } else {
      return { ok: false };
    }
    dispatchEvents(el, ['click']);
    field.value = el.checked ? 'checked' : 'unchecked';
    field.filled = true;
    return { ok: true };
  }
 
  function fillCheckboxGroup(field, spokenValue) {
    if (/\b(none|no|nothing|skip)\b/i.test(spokenValue.trim())) {
      field.value = 'none selected';
      field.filled = true;
      return { ok: true, matched: 'none' };
    }
    const parts = spokenValue
      .split(/,| and /i)
      .map((s) => s.trim())
      .filter(Boolean);
    let matchedAny = false;
    parts.forEach((p) => {
      const match = matchOption(field.options, p);
      if (match) {
        match.element.checked = true;
        dispatchEvents(match.element, ['click']);
        matchedAny = true;
      }
    });
    if (!matchedAny) return { ok: false };
    field.value = field.options
      .filter((o) => o.element.checked)
      .map((o) => o.text)
      .join(', ');
    field.filled = true;
    return { ok: true, matched: field.value };
  }
 
  function fill(field, spokenValue) {
    switch (field.type) {
      case 'text':
      case 'email':
      case 'tel':
      case 'date':
      case 'number':
      case 'url':
      case 'search':
      case 'textarea':
        return fillTextLike(field, spokenValue);
      case 'select':
      case 'select-multiple':
        return fillSelect(field, spokenValue);
      case 'radio':
        return fillRadio(field, spokenValue);
      case 'checkbox':
        return fillCheckbox(field, spokenValue);
      case 'checkbox-group':
        return fillCheckboxGroup(field, spokenValue);
      default:
        return { ok: false };
    }
  }
 
  VF.filler = { fill, matchOption };
})();