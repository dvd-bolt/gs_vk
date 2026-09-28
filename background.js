/* ============================================================
   VK Voice Downloader — Background Service Worker v1.4
   Features: Strict Voice Message Filtering (Excludes all notification/UI mp3s)
   Captures network audio streams via chrome.webRequest API
   ============================================================ */

const tabAudioStore = new Map();

function normalizeAudioUrl(url) {
  if (!url || typeof url !== 'string') return null;
  let clean = url.trim().replace(/\\_/g, '_').replace(/\\\//g, '/').replace(/\\"/g, '"');
  if (clean.startsWith('//')) clean = 'https:' + clean;
  if (clean.startsWith('/')) clean = 'https://vk.com' + clean;
  if (!/^https?:\/\//i.test(clean)) return null;
  return clean;
}

function isNotificationSound(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  return (
    lower.includes('/mp3/') ||
    lower.includes('/sound/') ||
    lower.includes('/sounds/') ||
    lower.includes('sound_') ||
    lower.includes('msg.mp3') ||
    lower.includes('notification') ||
    lower.includes('message.mp3') ||
    lower.includes('beep') ||
    lower.includes('incoming.mp3') ||
    lower.includes('call.mp3')
  );
}

function isVkVoiceMessageUrl(rawUrl) {
  const url = normalizeAudioUrl(rawUrl);
  if (!url) return false;

  // STRICT RULE: If it's a notification/UI sound, REJECT IT!
  if (isNotificationSound(url)) return false;

  // Ignore extension internal requests
  if (url.startsWith('chrome-extension:')) return false;

  // MUST match VK Voice Message indicators
  return (
    /\.ogg($|\?)/i.test(url) ||
    /link_ogg/i.test(url) ||
    /\/s\/v1\/(ac|doc)\//i.test(url) ||
    /userapi\.net\/s\/v1\//i.test(url) ||
    /userapi\.com\/s\/v1\//i.test(url) ||
    /psv\d*\.vk/i.test(url) ||
    /audiomsg/i.test(url) ||
    /audio_message/i.test(url)
  );
}

function storeAudioForTab(tabId, rawUrl, contentType = 'audio/ogg') {
  const url = normalizeAudioUrl(rawUrl);
  if (!tabId || tabId < 0 || !url) return;
  if (!isVkVoiceMessageUrl(url)) return;

  if (!tabAudioStore.has(tabId)) {
    tabAudioStore.set(tabId, new Map());
  }

  const store = tabAudioStore.get(tabId);
  if (!store.has(url)) {
    const index = store.size + 1;
    store.set(url, {
      url: url,
      title: `Голосовое сообщение #${index}`,
      timestamp: Date.now(),
      contentType: contentType
    });
    console.log(`[VK Voice DL Background] Saved Voice Message for tab ${tabId}:`, url);
  }
}

// 1. Network Listeners (webRequest)
try {
  chrome.webRequest.onHeadersReceived.addListener(
    (details) => {
      if (details.tabId && details.tabId >= 0) {
        if (isVkVoiceMessageUrl(details.url)) {
          storeAudioForTab(details.tabId, details.url);
        }
      }
    },
    { urls: ['<all_urls>'] },
    ['responseHeaders']
  );

  chrome.webRequest.onBeforeRequest.addListener(
    (details) => {
      if (details.tabId && details.tabId >= 0) {
        if (isVkVoiceMessageUrl(details.url)) {
          storeAudioForTab(details.tabId, details.url);
        }
      }
    },
    { urls: ['<all_urls>'] }
  );
} catch (e) {
  console.warn('[VK Voice DL Background] webRequest error:', e);
}

chrome.tabs.onRemoved.addListener((tabId) => {
  tabAudioStore.delete(tabId);
});

// 2. Message Listeners
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = sender.tab ? sender.tab.id : null;

  if (message.action === 'reportAudioUrl' && tabId) {
    storeAudioForTab(tabId, message.url);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'downloadVoice') {
    handleDownload(message)
      .then((downloadId) => sendResponse({ success: true, downloadId }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (message.action === 'getVoiceCount' || message.action === 'collectAllVoices') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTab = tabs[0];
      const activeTabId = activeTab ? activeTab.id : null;

      const networkVoices = activeTabId && tabAudioStore.has(activeTabId)
        ? Array.from(tabAudioStore.get(activeTabId).values())
        : [];

      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { action: 'collectAllVoices' }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              count: networkVoices.length,
              voices: networkVoices
            });
            return;
          }

          const pageVoices = response?.voices || [];
          const mergedMap = new Map();

          networkVoices.forEach((v) => {
            if (isVkVoiceMessageUrl(v.url)) mergedMap.set(v.url, v);
          });

          pageVoices.forEach((v) => {
            const norm = normalizeAudioUrl(v.url);
            if (norm && isVkVoiceMessageUrl(norm) && !mergedMap.has(norm)) {
              mergedMap.set(norm, { ...v, url: norm });
            }
          });

          const allVoices = Array.from(mergedMap.values());
          sendResponse({
            count: allVoices.length,
            voices: allVoices
          });
        });
      } else {
        sendResponse({
          count: networkVoices.length,
          voices: networkVoices
        });
      }
    });
    return true;
  }

  if (message.action === 'downloadAllVoices') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const activeTabId = tabs[0] ? tabs[0].id : null;
      const networkVoices = activeTabId && tabAudioStore.has(activeTabId)
        ? Array.from(tabAudioStore.get(activeTabId).values())
        : [];

      if (activeTabId) {
        chrome.tabs.sendMessage(activeTabId, { action: 'collectAllVoices' }, async (response) => {
          const pageVoices = response?.voices || [];
          const mergedMap = new Map();

          networkVoices.forEach((v) => {
            if (isVkVoiceMessageUrl(v.url)) mergedMap.set(v.url, v);
          });
          pageVoices.forEach((v) => {
            const norm = normalizeAudioUrl(v.url);
            if (norm && isVkVoiceMessageUrl(norm)) mergedMap.set(norm, { ...v, url: norm });
          });

          const allVoices = Array.from(mergedMap.values());

          if (allVoices.length > 0) {
            const results = await downloadAllSequentially(allVoices);
            sendResponse({ success: true, downloaded: results.length });
          } else {
            sendResponse({ success: false, error: 'Голосовые не найдены' });
          }
        });
      } else {
        sendResponse({ success: false, error: 'Нет активной вкладки' });
      }
    });
    return true;
  }
});

async function handleDownload({ url, filename }) {
  const normUrl = normalizeAudioUrl(url);
  if (!normUrl || !isVkVoiceMessageUrl(normUrl)) {
    throw new Error('Некорректный URL голосового сообщения');
  }

  const safeFilename = sanitizeFilename(filename || generateFilename());

  return new Promise((resolve, reject) => {
    chrome.downloads.download(
      {
        url: normUrl,
        filename: `VK_Voices/${safeFilename}`,
        conflictAction: 'uniquify',
        saveAs: false
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(downloadId);
        }
      }
    );
  });
}

async function downloadAllSequentially(voices) {
  const results = [];
  for (let i = 0; i < voices.length; i++) {
    try {
      const downloadId = await handleDownload({
        url: voices[i].url,
        filename: voices[i].filename || generateFilename(i + 1)
      });
      results.push({ downloadId, url: voices[i].url });
      if (i < voices.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
      }
    } catch (err) {
      console.warn(`[VK Voice DL] Failed download #${i + 1}:`, err.message);
    }
  }
  return results;
}

function generateFilename(index) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  const suffix = index ? `_${index}` : '';
  return `vk_voice_${date}_${time}${suffix}.ogg`;
}

function sanitizeFilename(name) {
  return name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^\.+/, '')
    .substring(0, 200);
}
