/* ============================================================
   VK Voice Downloader — Content Script v1.7
   Duration Matching & Dynamic Button URL Updates.
   ============================================================ */

(function () {
  'use strict';

  if (window.__vkVoiceDLInjected) return;
  window.__vkVoiceDLInjected = true;

  // Global registry: url -> { url, duration, timestamp }
  const audioRegistry = new Map();
  const PROCESSED_ATTR = 'data-vkvd-done';
  const BUTTON_CLASS = 'vkvd-download-btn';

  const ICON_DOWNLOAD = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="7 10 12 15 17 10"/>
      <line x1="12" y1="15" x2="12" y2="3"/>
    </svg>`;

  const ICON_CHECK = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>`;

  const ICON_ERROR = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>`;

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
    const norm = normalizeAudioUrl(rawUrl);
    if (!norm) return false;
    if (isNotificationSound(norm)) return false;

    return (
      /\.ogg($|\?)/i.test(norm) ||
      /link_ogg/i.test(norm) ||
      /\/s\/v1\/(ac|doc)\//i.test(norm) ||
      /userapi\.net\/s\/v1\//i.test(norm) ||
      /userapi\.com\/s\/v1\//i.test(norm) ||
      /psv\d*\.vk/i.test(norm) ||
      /audiomsg/i.test(norm) ||
      /audio_message/i.test(norm)
    );
  }

  function parseDurationTextToSeconds(text) {
    if (!text || typeof text !== 'string') return null;
    const parts = text.trim().split(':');
    if (parts.length === 2) {
      const m = parseInt(parts[0], 10);
      const s = parseInt(parts[1], 10);
      if (!isNaN(m) && !isNaN(s)) {
        return m * 60 + s;
      }
    }
    return null;
  }

  function injectPageScript() {
    try {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.onload = () => script.remove();
      (document.head || document.documentElement).appendChild(script);
    } catch (e) {
      console.warn('[VK Voice DL] Script injection error:', e);
    }
  }

  window.addEventListener('VKVD_AUDIO_URL_FOUND', (e) => {
    const rawUrl = e.detail && e.detail.url;
    const duration = e.detail && e.detail.duration;
    const norm = normalizeAudioUrl(rawUrl);

    if (norm && isVkVoiceMessageUrl(norm)) {
      registerAudioUrl(norm, duration);
      try {
        chrome.runtime.sendMessage({ action: 'reportAudioUrl', url: norm });
      } catch (err) {}
      scanForVoiceMessages();
    }
  });

  function registerAudioUrl(url, duration = null) {
    const norm = normalizeAudioUrl(url);
    if (!norm || !isVkVoiceMessageUrl(norm)) return;

    if (!audioRegistry.has(norm)) {
      audioRegistry.set(norm, {
        url: norm,
        duration: duration,
        title: duration ? `Голосовое сообщение (${formatSeconds(duration)})` : 'Голосовое сообщение',
        timestamp: Date.now()
      });
      console.log('[VK Voice DL Content] Registered Voice Message:', norm, 'duration:', duration);
    } else if (duration && !audioRegistry.get(norm).duration) {
      audioRegistry.get(norm).duration = duration;
    }
  }

  function formatSeconds(sec) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function findUrlByDurationSeconds(targetSec) {
    if (!targetSec) return null;
    for (const [url, item] of audioRegistry.entries()) {
      if (item.duration === targetSec) {
        return url;
      }
    }
    return null;
  }

  function scanForVoiceMessages() {
    // 1. Scan <audio> and <source>
    document.querySelectorAll('audio, source').forEach((audio) => {
      const src = audio.src || audio.getAttribute('src');
      const norm = normalizeAudioUrl(src);
      if (norm && isVkVoiceMessageUrl(norm)) {
        registerAudioUrl(norm);
        const container = findAudioPlayerContainer(audio);
        if (container) injectDownloadButton(container, norm);
      }
    });

    // 2. Scan data attributes
    const dataSelectors = [
      '[data-ogg]', '[data-mp3]', '[data-audio]', '[data-src]', '[data-url]',
      '[data-voice]', '[data-doc]', '[data-mp3-url]'
    ].join(',');

    document.querySelectorAll(dataSelectors).forEach((el) => {
      const url = extractUrlFromElement(el);
      if (url && isVkVoiceMessageUrl(url)) {
        registerAudioUrl(url);
        injectDownloadButton(el, url);
      }
    });

    // 3. Heuristic Text & Structure Scanning
    const allElements = document.querySelectorAll('div, span, p, a, section');
    const durationRegex = /^\d{1,2}:\d{2}$/;

    allElements.forEach((el) => {
      if (el.children.length === 0 && durationRegex.test(el.textContent.trim())) {
        const text = el.textContent.trim();
        const durationSec = parseDurationTextToSeconds(text);
        const playerContainer = findAudioPlayerContainer(el);

        if (playerContainer) {
          let url = extractUrlFromElement(playerContainer) || findUrlInParents(playerContainer);

          if (!url && durationSec) {
            url = findUrlByDurationSeconds(durationSec);
          }

          if (!url && typeof window.__vkvdExtractFromElement === 'function') {
            url = window.__vkvdExtractFromElement(playerContainer);
          }

          if (url && isVkVoiceMessageUrl(url)) {
            registerAudioUrl(url, durationSec);
            injectDownloadButton(playerContainer, url, text);
          } else {
            injectDownloadButton(playerContainer, null, text);
          }
        }
      }
    });
  }

  function findAudioPlayerContainer(startEl) {
    let current = startEl;
    let depth = 0;

    while (current && current !== document.body && depth < 7) {
      const hasPlayIcon = current.querySelector('svg, button, i, [role="button"]');
      const hasWaveform = current.querySelector('canvas, [class*="waveform"], [class*="wave"], [class*="track"]');
      const isVoiceContainer = (
        current.getAttribute('data-audio') ||
        current.getAttribute('data-ogg') ||
        (hasPlayIcon && hasWaveform) ||
        current.classList.contains('audio-msg-track') ||
        current.className.toString().toLowerCase().includes('voice') ||
        current.className.toString().toLowerCase().includes('audio')
      );

      if (isVoiceContainer) return current;
      current = current.parentElement;
      depth++;
    }
    return startEl.parentElement || startEl;
  }

  function extractUrlFromElement(el) {
    if (!el) return null;

    for (const attr of ['data-ogg', 'data-mp3', 'data-src', 'data-url', 'data-audio', 'href']) {
      const val = el.getAttribute(attr);
      if (val) {
        const norm = normalizeAudioUrl(val);
        if (norm && isVkVoiceMessageUrl(norm)) return norm;

        try {
          const parsed = JSON.parse(val);
          const raw = parsed.url || parsed.src || parsed.ogg || parsed.mp3 || parsed.link_ogg || parsed.link_mp3;
          const parsedNorm = normalizeAudioUrl(raw);
          if (parsedNorm && isVkVoiceMessageUrl(parsedNorm)) return parsedNorm;
        } catch (e) {}
      }
    }

    const matches = el.innerHTML.match(/(?:https?:)?\/\/[^\s"'<>]+?(?:\/s\/v1\/(?:ac|doc)\/[^\s"'<>]+|\.ogg[^\s"'<>]*)?/gi);
    if (matches && matches.length > 0) {
      for (const m of matches) {
        const norm = normalizeAudioUrl(m);
        if (norm && isVkVoiceMessageUrl(norm)) return norm;
      }
    }

    return null;
  }

  function findUrlInParents(el) {
    let curr = el.parentElement;
    let depth = 0;
    while (curr && curr !== document.body && depth < 8) {
      const url = extractUrlFromElement(curr);
      if (url) return url;
      curr = curr.parentElement;
      depth++;
    }
    return null;
  }

  function injectDownloadButton(container, initialUrl, durationText = '') {
    if (!container) return;

    const normInitial = normalizeAudioUrl(initialUrl);
    const existingBtn = container.querySelector(`.${BUTTON_CLASS}`);

    if (existingBtn) {
      if (normInitial && isVkVoiceMessageUrl(normInitial)) {
        existingBtn.setAttribute('data-vkvd-url', normInitial);
      }
      return;
    }

    container.setAttribute(PROCESSED_ATTR, '1');

    const btn = document.createElement('button');
    btn.className = BUTTON_CLASS;
    btn.type = 'button';
    btn.title = 'Скачать голосовое сообщение';
    btn.innerHTML = ICON_DOWNLOAD;

    if (normInitial && isVkVoiceMessageUrl(normInitial)) {
      btn.setAttribute('data-vkvd-url', normInitial);
    }

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Find duration text inside container
      const durationEl = Array.from(container.querySelectorAll('*')).find(
        (child) => child.children.length === 0 && /^\d{1,2}:\d{2}$/.test(child.textContent.trim())
      );
      const durationSec = durationEl ? parseDurationTextToSeconds(durationEl.textContent.trim()) : null;

      let targetUrl = normalizeAudioUrl(btn.getAttribute('data-vkvd-url')) ||
        extractUrlFromElement(container) ||
        findUrlInParents(container);

      if (!targetUrl && durationSec) {
        targetUrl = findUrlByDurationSeconds(durationSec);
      }

      if (!targetUrl && typeof window.__vkvdExtractFromElement === 'function') {
        targetUrl = window.__vkvdExtractFromElement(container);
      }

      if (targetUrl && isVkVoiceMessageUrl(targetUrl)) {
        triggerDownload(targetUrl, btn);
      } else {
        // Fallback: Trigger play click to force VK audio player engine to load audio URL
        setButtonState(btn, 'downloading', 'Получение голосового...');

        const playBtn = container.querySelector('button, [role="button"], svg, canvas') || container;
        playBtn.click();

        let checks = 0;
        const checkInterval = setInterval(() => {
          checks++;

          targetUrl = normalizeAudioUrl(btn.getAttribute('data-vkvd-url')) ||
            extractUrlFromElement(container) ||
            findUrlInParents(container);

          if (!targetUrl && durationSec) {
            targetUrl = findUrlByDurationSeconds(durationSec);
          }

          if (!targetUrl && typeof window.__vkvdExtractFromElement === 'function') {
            targetUrl = window.__vkvdExtractFromElement(container);
          }

          if (targetUrl && isVkVoiceMessageUrl(targetUrl)) {
            clearInterval(checkInterval);
            const audioTag = container.querySelector('audio') || document.querySelector('audio');
            if (audioTag && !audioTag.paused) {
              audioTag.pause();
            }
            triggerDownload(targetUrl, btn);
          } else if (checks > 10) {
            clearInterval(checkInterval);
            const validVoices = Array.from(audioRegistry.keys()).filter((u) => isVkVoiceMessageUrl(u));
            const latestRegistryUrl = validVoices.pop();

            if (latestRegistryUrl) {
              triggerDownload(latestRegistryUrl, btn);
            } else {
              setButtonState(btn, 'error', 'Нажмите Play для загрузки');
            }
          }
        }, 150);
      }
    });

    const durationEl = Array.from(container.querySelectorAll('*')).find(
      (child) => child.children.length === 0 && /^\d{1,2}:\d{2}$/.test(child.textContent.trim())
    );

    if (durationEl && durationEl.parentElement) {
      durationEl.parentElement.appendChild(btn);
    } else {
      container.appendChild(btn);
    }
  }

  function fallbackDirectDownload(url, defaultFilename = 'vk_voice.ogg') {
    try {
      const a = document.createElement('a');
      a.href = url;
      a.download = defaultFilename;
      a.target = '_blank';
      a.rel = 'noopener';
      (document.body || document.documentElement).appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (e) {
      console.warn('[VK Voice DL] Fallback download failed:', e);
      return false;
    }
  }

  function triggerDownload(url, buttonEl) {
    const norm = normalizeAudioUrl(url);
    if (!norm || !isVkVoiceMessageUrl(norm)) {
      setButtonState(buttonEl, 'error', 'Некорректный URL');
      return;
    }

    setButtonState(buttonEl, 'downloading', 'Скачивание...');

    try {
      chrome.runtime.sendMessage(
        { action: 'downloadVoice', url: norm, filename: null },
        (response) => {
          if (chrome.runtime.lastError || !response || !response.success) {
            const ok = fallbackDirectDownload(norm);
            if (ok) {
              setButtonState(buttonEl, 'success', 'Скачано!');
            } else {
              setButtonState(buttonEl, 'error', 'Ошибка скачивания');
            }
            return;
          }

          setButtonState(buttonEl, 'success', 'Скачано!');
        }
      );
    } catch (err) {
      const ok = fallbackDirectDownload(norm);
      if (ok) {
        setButtonState(buttonEl, 'success', 'Скачано!');
      } else {
        setButtonState(buttonEl, 'error', 'Ошибка скачивания');
      }
    }
  }

  function setButtonState(btn, state, text = '') {
    btn.classList.remove('vkvd-downloading', 'vkvd-success', 'vkvd-error');

    if (state === 'downloading') {
      btn.classList.add('vkvd-downloading');
      btn.title = text || 'Скачивание...';
    } else if (state === 'success') {
      btn.classList.add('vkvd-success');
      btn.title = text || 'Скачано!';
      btn.innerHTML = ICON_CHECK;
      setTimeout(() => resetBtn(btn), 2500);
    } else if (state === 'error') {
      btn.classList.add('vkvd-error');
      btn.title = text || 'Ошибка';
      btn.innerHTML = ICON_ERROR;
      setTimeout(() => resetBtn(btn), 3000);
    }
  }

  function resetBtn(btn) {
    btn.classList.remove('vkvd-downloading', 'vkvd-success', 'vkvd-error');
    btn.title = 'Скачать голосовое сообщение';
    btn.innerHTML = ICON_DOWNLOAD;
  }

  function setupObserver() {
    let scanTimeout = null;

    const observer = new MutationObserver(() => {
      clearTimeout(scanTimeout);
      scanTimeout = setTimeout(scanForVoiceMessages, 250);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    setInterval(scanForVoiceMessages, 1200);
  }

  function setupMessageListener() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'countVoices' || message.action === 'collectAllVoices') {
        scanForVoiceMessages();

        const list = Array.from(audioRegistry.values()).filter((v) => isVkVoiceMessageUrl(v.url));
        sendResponse({
          count: list.length,
          voices: list
        });
        return true;
      }

      if (message.action === 'rescan') {
        document.querySelectorAll(`[${PROCESSED_ATTR}]`).forEach((el) => el.removeAttribute(PROCESSED_ATTR));
        document.querySelectorAll(`.${BUTTON_CLASS}`).forEach((btn) => btn.remove());

        scanForVoiceMessages();

        const list = Array.from(audioRegistry.values()).filter((v) => isVkVoiceMessageUrl(v.url));
        sendResponse({
          count: list.length,
          voices: list
        });
        return true;
      }
    });
  }

  injectPageScript();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      scanForVoiceMessages();
      setupObserver();
      setupMessageListener();
    });
  } else {
    scanForVoiceMessages();
    setupObserver();
    setupMessageListener();
  }

  console.log('[VK Voice DL] Content script v1.7 active.');
})();
