/**
 * VoxFill - content-script.js
 *
 * Entry point injected into the page. Creates a small on-page overlay
 * (useful for low-vision users, and as a screen-reader aria-live region),
 * relays status to the popup/background, and listens for start/stop
 * commands from the popup.
 */
(function () {
  const VF = (window.VoxFill = window.VoxFill || {});

  let overlay = null;
  let statusEl = null;
  let logEl = null;
  let liveRegion = null;

  function createOverlay() {
    if (document.getElementById('voxfill-overlay')) return;

    overlay = document.createElement('div');
    overlay.id = 'voxfill-overlay';
    overlay.setAttribute('role', 'status');
    overlay.style.cssText = [
      'position: fixed',
      'bottom: 16px',
      'right: 16px',
      'z-index: 2147483647',
      'background: #0b1f3a',
      'color: #ffffff',
      'padding: 14px 16px',
      'border-radius: 10px',
      'font-family: Arial, Helvetica, sans-serif',
      'font-size: 14px',
      'max-width: 320px',
      'box-shadow: 0 6px 24px rgba(0,0,0,0.35)',
      'line-height: 1.4',
    ].join(';');

    overlay.innerHTML =
      '<div style="font-weight:bold; margin-bottom:6px; display:flex; align-items:center; gap:6px;">' +
      '<span aria-hidden="true">\u{1F399}\uFE0F</span> VoxFill' +
      '</div>' +
      '<div id="voxfill-status">Idle</div>' +
      '<div id="voxfill-log" style="margin-top:8px; max-height:140px; overflow:auto; font-size:12px; opacity:0.85;"></div>';

    document.body.appendChild(overlay);
    statusEl = overlay.querySelector('#voxfill-status');
    logEl = overlay.querySelector('#voxfill-log');

    liveRegion = document.createElement('div');
    liveRegion.setAttribute('aria-live', 'polite');
    liveRegion.style.cssText =
      'position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap;';
    document.body.appendChild(liveRegion);
  }

  VF.ui = {
    setStatus(text) {
      createOverlay();
      if (statusEl) statusEl.textContent = text;
      if (liveRegion) liveRegion.textContent = text;
      try {
        chrome.runtime.sendMessage({ type: 'voxfill-status', text });
      } catch (e) {
        /* popup may be closed / no receiver - safe to ignore */
      }
    },
    log(text) {
      createOverlay();
      if (logEl) {
        const line = document.createElement('div');
        line.textContent = text;
        logEl.prepend(line);
        while (logEl.children.length > 12) {
          logEl.removeChild(logEl.lastChild);
        }
      }
      try {
        chrome.runtime.sendMessage({ type: 'voxfill-log', text });
      } catch (e) {
        /* ignore */
      }
    },
    notifyDone() {
      try {
        chrome.runtime.sendMessage({ type: 'voxfill-done' });
      } catch (e) {
        /* ignore */
      }
    },
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.action === 'start') {
      VF.conversation.start();
      sendResponse({ ok: true });
    } else if (message && message.action === 'stop') {
      VF.conversation.stop('Stopping voice assistant.');
      sendResponse({ ok: true });
    } else if (message && message.action === 'ping') {
      sendResponse({ ok: true });
    }
    return true;
  });
})();
