/**
 * VoxFill - form-scanner.js
 *
 * Scans the current page for visible, fillable form fields and builds a
 * normalized list of "field descriptors" describing each one: its type,
 * a human-readable label (detected from <label>, aria-*, placeholder,
 * name/id, or nearby text), whether it is required, and (for
 * select/radio/checkbox groups) its available options.
 *
 * No field names are ever hardcoded - everything is detected from the DOM.
 */
(function () {
  const VF = (window.VoxFill = window.VoxFill || {});

  function isVisible(el) {
    if (!el) return false;
    if (el.disabled) return false;
    if (el.type === 'hidden') return false;
    if (el.hasAttribute('hidden')) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;

    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
      return false;
    }
    // offsetParent is null for display:none elements and for position:fixed
    // in some browsers, so only treat it as "hidden" when not fixed.
    if (el.offsetParent === null && style.position !== 'fixed') {
      return false;
    }
    return true;
  }

  function humanize(str) {
    if (!str) return '';
    return str
      .replace(/[_\-]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\[\d*\]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase()
      .replace(/^./, (c) => c.toUpperCase());
  }

  function textOf(el) {
    if (!el) return '';
    const t = el.innerText != null ? el.innerText : el.textContent;
    return (t || '').trim();
  }

  function getLabelViaFor(el) {
    if (el.id) {
      try {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const text = textOf(label);
        if (text) return text;
      } catch (e) {
        /* invalid id for CSS.escape - ignore */
      }
    }
    return null;
  }

  function getLabelViaWrap(el) {
    const label = el.closest('label');
    if (label) {
      const clone = label.cloneNode(true);
      // Remove the input's own text/value contribution from the label text
      clone.querySelectorAll('input, select, textarea').forEach((n) => n.remove());
      const text = textOf(clone);
      if (text) return text;
    }
    return null;
  }

  function getLabelViaAriaLabelledby(el) {
    const attr = el.getAttribute('aria-labelledby');
    if (attr) {
      const ids = attr.split(/\s+/);
      const text = ids
        .map((id) => textOf(document.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }
    return null;
  }

  function getPrecedingText(el) {
    let node = el.previousSibling;
    let hops = 0;
    while (node && hops < 5) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return node.textContent.trim();
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const text = textOf(node);
        if (text) return text;
      }
      node = node.previousSibling;
      hops++;
    }
    // Fall back to a preceding <label>-like sibling in the parent container
    const parent = el.parentElement;
    if (parent) {
      const legend = parent.querySelector('legend');
      const text = textOf(legend);
      if (text) return text;
    }
    return null;
  }

  function detectLabel(el) {
    return (
      getLabelViaFor(el) ||
      getLabelViaWrap(el) ||
      el.getAttribute('aria-label') ||
      getLabelViaAriaLabelledby(el) ||
      el.getAttribute('placeholder') ||
      getPrecedingText(el) ||
      humanize(el.name) ||
      humanize(el.id) ||
      'Unnamed field'
    );
  }

  function detectType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'textarea') return 'textarea';
    if (tag === 'select') return el.multiple ? 'select-multiple' : 'select';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'radio') return 'radio';
      if (t === 'checkbox') return 'checkbox';
      // Never handle password, file, or hidden fields via voice - too sensitive
      // or not applicable.
      if (['password', 'hidden', 'submit', 'button', 'reset', 'file', 'image'].includes(t)) {
        return 'ignore';
      }
      if (['email', 'tel', 'date', 'number', 'url', 'text', 'search'].includes(t)) return t;
      return 'text';
    }
    return 'ignore';
  }

  function isRequired(el) {
    return !!el.required || el.getAttribute('aria-required') === 'true';
  }

  /**
   * Scans the document and returns an array of field descriptors:
   * {
   *   id, type, label, required, elements: [HTMLElement...],
   *   options: [{value, text, element}], filled, value
   * }
   */
  function scan() {
    const handledGroups = new Set();
    const fields = [];
    const candidates = Array.from(document.querySelectorAll('input, select, textarea'));

    candidates.forEach((el) => {
      const type = detectType(el);
      if (type === 'ignore') return;
      if (!isVisible(el)) return;

      if (type === 'radio') {
        const groupKey = 'radio:' + (el.name || el.id || Math.random());
        if (handledGroups.has(groupKey)) return;
        handledGroups.add(groupKey);

        let group = [el];
        if (el.name) {
          try {
            group = Array.from(
              document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)
            ).filter(isVisible);
          } catch (e) {
            group = [el];
          }
        }
        const options = group.map((r) => ({ value: r.value, text: detectLabel(r), element: r }));
        fields.push({
          id: 'field_' + fields.length,
          type: 'radio',
          label: humanize(el.name) || getPrecedingText(el) || 'Choose an option',
          required: group.some(isRequired),
          elements: group,
          options,
          filled: false,
          value: null,
        });
        return;
      }

      if (type === 'checkbox') {
        let sameNameBoxes = [el];
        if (el.name) {
          try {
            sameNameBoxes = Array.from(
              document.querySelectorAll(`input[type="checkbox"][name="${CSS.escape(el.name)}"]`)
            ).filter(isVisible);
          } catch (e) {
            sameNameBoxes = [el];
          }
        }

        if (sameNameBoxes.length > 1) {
          const groupKey = 'checkboxgroup:' + el.name;
          if (handledGroups.has(groupKey)) return;
          handledGroups.add(groupKey);
          const options = sameNameBoxes.map((c) => ({
            value: c.value,
            text: detectLabel(c),
            element: c,
          }));
          fields.push({
            id: 'field_' + fields.length,
            type: 'checkbox-group',
            label: humanize(el.name) || 'Select options',
            required: sameNameBoxes.some(isRequired),
            elements: sameNameBoxes,
            options,
            filled: false,
            value: null,
          });
        } else {
          fields.push({
            id: 'field_' + fields.length,
            type: 'checkbox',
            label: detectLabel(el),
            required: isRequired(el),
            elements: [el],
            options: [],
            filled: false,
            value: null,
          });
        }
        return;
      }

      if (type === 'select' || type === 'select-multiple') {
        const options = Array.from(el.options)
          .filter((o) => o.value !== '' || o.text.trim() !== '')
          .map((o) => ({ value: o.value, text: o.text.trim(), element: o }));
        fields.push({
          id: 'field_' + fields.length,
          type,
          label: detectLabel(el),
          required: isRequired(el),
          elements: [el],
          options,
          filled: false,
          value: null,
        });
        return;
      }

      // text-like inputs (text, email, tel, date, number, url, search) and textarea
      fields.push({
        id: 'field_' + fields.length,
        type,
        label: detectLabel(el),
        required: isRequired(el),
        elements: [el],
        options: [],
        filled: false,
        value: null,
      });
    });

    return fields;
  }

  VF.scanner = { scan, humanize, isVisible, detectLabel };
})();
