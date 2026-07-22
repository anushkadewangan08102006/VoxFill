/**
 * VoxFill - popup.js
 *
 * Starts/stops the voice assistant on the active tab, and mirrors the
 * status + conversation log that the content script reports.
 */
const CONTENT_SCRIPT_FILES = [
  'form-scanner.js',
  'form-filler.js',
  'voice-engine.js',
  'conversation-manager.js',
  'content-script.js',
];

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

/** Makes sure the content script is present on the tab, injecting it if the
 * declarative content_scripts registration hasn't run yet (e.g. the page
 * was already open when the extension was installed/reloaded). */
async function ensureContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: 'ping' });
    return true;
  } catch (e) {
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPT_FILES });
      return true;
    } catch (err) {
      return false;
    }
  }
}

function addLogLine(logEl, text) {
  const div = document.createElement('div');
  div.className = 'log-line';
  div.textContent = text;
  logEl.prepend(div);
  while (logEl.children.length > 30) {
    logEl.removeChild(logEl.lastChild);
  }
}

function init() {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const statusEl = document.getElementById('status');
  const logEl = document.getElementById('log');

  chrome.runtime.onMessage.addListener((message) => {
    if (!message) return;
    if (message.type === 'voxfill-status') {
      statusEl.textContent = message.text;
    } else if (message.type === 'voxfill-log') {
      addLogLine(logEl, message.text);
    } else if (message.type === 'voxfill-done') {
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  });

  startBtn.addEventListener('click', async () => {
    statusEl.textContent = 'Starting...';
    const tab = await getActiveTab();

    if (!tab || !tab.id || !/^https?:/.test(tab.url || '')) {
      statusEl.textContent = 'VoxFill only works on regular web pages (http/https), not on browser-internal pages.';
      return;
    }

    const ready = await ensureContentScript(tab.id);
    if (!ready) {
      statusEl.textContent = 'Could not access this page. Try reloading it and clicking Start again.';
      return;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, { action: 'start' });
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } catch (e) {
      statusEl.textContent = 'Could not start the assistant on this page.';
    }
  });

  stopBtn.addEventListener('click', async () => {
    const tab = await getActiveTab();
    if (tab && tab.id) {
      try {
        await chrome.tabs.sendMessage(tab.id, { action: 'stop' });
      } catch (e) {
        /* ignore */
      }
    }
    startBtn.disabled = false;
    stopBtn.disabled = true;
  });
}

document.addEventListener('DOMContentLoaded', init);
