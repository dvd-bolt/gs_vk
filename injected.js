/* ============================================================
   VK Voice Downloader — Page Context Interceptor v1.7
   Captures link_ogg, link_mp3, and duration from VK JSON responses.
   ============================================================ */

(function () {
  'use strict';

  if (window.__vkvdPageScriptInjected) return;
  window.__vkvdPageScriptInjected = true;

  const audioUrlSet = new Set();

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

  function isVkVoiceMessageUrl(url) {
    const norm = normalizeAudioUrl(url);
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

  function notifyVoiceMessageDetected(rawUrl, duration = null) {
    const url = normalizeAudioUrl(rawUrl);
    if (!url || !isVkVoiceMessageUrl(url)) return;
    if (audioUrlSet.has(url)) return;

    audioUrlSet.add(url);
    console.log('[VK Voice DL] Intercepted Voice Message URL:', url, 'duration:', duration);

    window.dispatchEvent(
      new CustomEvent('VKVD_AUDIO_URL_FOUND', {
        detail: { url: url, duration: duration }
      })
    );
  }

  // 1. Scan JSON/AJAX Response Text for audio_message objects with link_ogg & duration
  function scanTextForVoiceUrls(text) {
    if (!text || typeof text !== 'string') return;
    if (text.length > 5000000) return;

    // Search for JSON blocks containing audio_message
    const audioMsgRegex = /"audio_message"\s*:\s*\{([^}]+)\}/gi;
    let match;
    while ((match = audioMsgRegex.exec(text)) !== null) {
      const block = match[1];
      const linkOggMatch = block.match(/"link_ogg"\s*:\s*"([^"]+)"/i);
      const linkMp3Match = block.match(/"link_mp3"\s*:\s*"([^"]+)"/i);
      const durationMatch = block.match(/"duration"\s*:\s*(\d+)/i);

      const duration = durationMatch ? parseInt(durationMatch[1], 10) : null;
      if (linkOggMatch && linkOggMatch[1]) {
        notifyVoiceMessageDetected(linkOggMatch[1], duration);
      } else if (linkMp3Match && linkMp3Match[1]) {
        notifyVoiceMessageDetected(linkMp3Match[1], duration);
      }
    }

    // Direct string matches for link_ogg
    const oggMatches = text.match(/"link_ogg"\s*:\s*"([^"]+)"/gi);
    if (oggMatches) {
      oggMatches.forEach((m) => {
        const raw = m.replace(/"link_ogg"\s*:\s*"/i, '').replace(/"$/, '');
        notifyVoiceMessageDetected(raw);
      });
    }

    // Direct string matches for link_mp3
    const mp3Matches = text.match(/"link_mp3"\s*:\s*"([^"]+)"/gi);
    if (mp3Matches) {
      mp3Matches.forEach((m) => {
        const raw = m.replace(/"link_mp3"\s*:\s*"/i, '').replace(/"$/, '');
        notifyVoiceMessageDetected(raw);
      });
    }

    // CDN URL pattern match
    const cdnMatches = text.match(/https?:\\?\/\\?\/[^\s"'<>]+?(?:\/s\/v1\/(?:ac|doc)\/[^\s"'<>]+|\.ogg[^\s"'<>]*)?/gi);
    if (cdnMatches) {
      cdnMatches.forEach((m) => {
        notifyVoiceMessageDetected(m);
      });
    }
  }

  // 2. Hook Fetch API
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url);
    if (url && isVkVoiceMessageUrl(url)) {
      notifyVoiceMessageDetected(url);
    }

    const response = await originalFetch.apply(this, args);
    try {
      const clone = response.clone();
      clone.text().then((text) => scanTextForVoiceUrls(text)).catch(() => {});
    } catch (e) {}

    return response;
  };

  // 3. Hook XMLHttpRequest
  const originalXhrOpen = XMLHttpRequest.prototype.open;
  const originalXhrSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url) {
    this.__vkvdUrl = url;
    if (url && isVkVoiceMessageUrl(url)) {
      notifyVoiceMessageDetected(url);
    }
    return originalXhrOpen.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function () {
    this.addEventListener('load', function () {
      try {
        if (this.responseText) {
          scanTextForVoiceUrls(this.responseText);
        }
      } catch (e) {}
    });
    return originalXhrSend.apply(this, arguments);
  };

  // 4. Hook HTMLMediaElement play
  const originalPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    const src = this.currentSrc || this.src;
    if (src) notifyVoiceMessageDetected(src);
    return originalPlay.apply(this, arguments);
  };

  document.addEventListener(
    'play',
    function (e) {
      if (e.target && (e.target.tagName === 'AUDIO' || e.target.tagName === 'VIDEO')) {
        const src = e.target.currentSrc || e.target.src;
        if (src) notifyVoiceMessageDetected(src);
      }
    },
    true
  );

  // 5. React Props / Fiber Inspection
  function extractFromReact(node, depth = 0) {
    if (!node || depth > 6) return null;

    if (typeof node === 'string') {
      const norm = normalizeAudioUrl(node);
      if (norm && isVkVoiceMessageUrl(norm)) return norm;
    }

    if (typeof node === 'object') {
      for (const key of ['link_ogg', 'link_mp3', 'linkOgg', 'linkMp3', 'url', 'src']) {
        if (node[key]) {
          const norm = normalizeAudioUrl(node[key]);
          if (norm && isVkVoiceMessageUrl(norm)) return norm;
        }
      }

      const am = node.audio_message || node.audioMessage;
      if (am && typeof am === 'object') {
        for (const key of ['link_ogg', 'link_mp3', 'linkOgg', 'linkMp3', 'url', 'src']) {
          if (am[key]) {
            const norm = normalizeAudioUrl(am[key]);
            if (norm && isVkVoiceMessageUrl(norm)) return norm;
          }
        }
      }

      if (node.memoizedProps) {
        const found = extractFromReact(node.memoizedProps, depth + 1);
        if (found) return found;
      }
      if (node.props) {
        const found = extractFromReact(node.props, depth + 1);
        if (found) return found;
      }
      if (node.children && Array.isArray(node.children)) {
        for (const child of node.children) {
          const found = extractFromReact(child, depth + 1);
          if (found) return found;
        }
      }
    }
    return null;
  }

  window.__vkvdExtractFromElement = function (el) {
    if (!el) return null;
    let curr = el;
    let depth = 0;
    while (curr && depth < 6) {
      for (const key of Object.keys(curr)) {
        if (key.startsWith('__reactProps') || key.startsWith('__reactFiber') || key.startsWith('__reactContainer')) {
          const url = extractFromReact(curr[key]);
          if (url) return url;
        }
      }
      curr = curr.parentElement;
      depth++;
    }
    return null;
  };

  // 6. Periodic Scan
  setInterval(() => {
    document.querySelectorAll('audio, source').forEach((el) => {
      const src = el.src || el.getAttribute('src');
      if (src && isVkVoiceMessageUrl(src)) {
        notifyVoiceMessageDetected(src);
      }
    });
  }, 1000);

  console.log('[VK Voice DL] Page interceptor v1.7 active.');
})();
