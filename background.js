/**
 * VoxFill - background.js (MV3 service worker)
 *
 * Minimal responsibilities:
 *  - Log installation.
 *  - Relay status messages from the content script into a badge on the
 *    toolbar icon, so the user can see at a glance whether VoxFill is
 *    active on the current tab.
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('VoxFill installed.');
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!sender.tab || typeof sender.tab.id !== 'number') return;
  const tabId = sender.tab.id;

  if (message && message.type === 'voxfill-status') {
    chrome.action.setBadgeText({ tabId, text: 'ON' });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#0b6efd' });
  } else if (message && message.type === 'voxfill-done') {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
});

chrome.tabs.onRemoved.addListener(() => {
  // No per-tab state currently stored in background; placeholder for
  // future per-tab session tracking.
});
