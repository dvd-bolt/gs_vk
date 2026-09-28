/* ============================================================
   VK Voice Downloader — Ultra Safe Popup Script v1.5
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  const statusIndicator = document.getElementById('statusIndicator');
  const statusText = document.getElementById('statusText');
  const counterSection = document.getElementById('counterSection');
  const voiceCount = document.getElementById('voiceCount');
  const downloadAllBtn = document.getElementById('downloadAllBtn');
  const rescanBtn = document.getElementById('rescanBtn');
  const voiceListContainer = document.getElementById('voiceListContainer');
  const voiceList = document.getElementById('voiceList');

  function safeQueryTab(callback) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs || !tabs[0]) {
          // Fallback query for split windows/devtools
          chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
            callback(fallbackTabs ? fallbackTabs[0] : null);
          });
        } else {
          callback(tabs[0]);
        }
      });
    } catch (e) {
      console.warn('[VKVD Popup] tab query error:', e);
      callback(null);
    }
  }

  function initPopup() {
    safeQueryTab((tab) => {
      if (!tab || !tab.url) {
        showInactive('Откройте страницу VK.com');
        return;
      }

      try {
        const url = new URL(tab.url);
        if (!url.hostname.includes('vk.com') && !url.hostname.includes('vk.ru')) {
          showInactive('Перейдите на сайт VK.com');
          return;
        }
      } catch (e) {
        showInactive('Откройте VK.com');
        return;
      }

      if (statusIndicator) statusIndicator.className = 'status-indicator searching';
      if (statusText) statusText.textContent = 'Поиск голосовых...';

      fetchVoiceMessages();
    });
  }

  function fetchVoiceMessages() {
    try {
      chrome.runtime.sendMessage({ action: 'collectAllVoices' }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[VKVD Popup] background message error:', chrome.runtime.lastError.message);
          // Try messaging active tab content script directly
          safeQueryTab((tab) => {
            if (tab && tab.id) {
              chrome.tabs.sendMessage(tab.id, { action: 'collectAllVoices' }, (tabRes) => {
                if (chrome.runtime.lastError) {
                  showInactive('Обновите страницу ВК (F5)');
                } else {
                  updateUI(tabRes?.voices || []);
                }
              });
            } else {
              showInactive('Обновите страницу ВК (F5)');
            }
          });
          return;
        }

        const voices = response?.voices || [];
        updateUI(voices);
      });
    } catch (err) {
      console.error('[VKVD Popup] fetchVoiceMessages error:', err);
      showInactive('Ошибка загрузки');
    }
  }

  function updateUI(voices) {
    const count = Array.isArray(voices) ? voices.length : 0;
    if (counterSection) counterSection.style.display = 'block';
    if (voiceCount) voiceCount.textContent = count;

    if (count > 0) {
      if (statusIndicator) statusIndicator.className = 'status-indicator active';
      if (statusText) statusText.textContent = `Найдено ${count} ${pluralize(count)}`;
      if (downloadAllBtn) downloadAllBtn.disabled = false;
      renderVoiceList(voices);
    } else {
      if (statusIndicator) statusIndicator.className = 'status-indicator active';
      if (statusText) statusText.textContent = 'Голосовые не найдены';
      if (downloadAllBtn) downloadAllBtn.disabled = true;
      if (voiceListContainer) voiceListContainer.style.display = 'none';
    }
  }

  function renderVoiceList(voices) {
    if (!voiceList || !voiceListContainer) return;
    voiceList.innerHTML = '';
    voiceListContainer.style.display = 'block';

    voices.forEach((voice, index) => {
      const item = document.createElement('div');
      item.className = 'voice-item';

      const title = voice.title || `Голосовое #${index + 1}`;

      item.innerHTML = `
        <div class="voice-item-info">
          <div class="voice-item-title">${escapeHtml(title)}</div>
          <div class="voice-item-sub">Голосовое сообщение .ogg</div>
        </div>
        <button class="voice-item-btn" title="Скачать">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
        </button>
      `;

      const btn = item.querySelector('.voice-item-btn');
      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.innerHTML = '...';

        try {
          chrome.runtime.sendMessage({
            action: 'downloadVoice',
            url: voice.url,
            filename: null
          }, (res) => {
            if (res?.success) {
              btn.innerHTML = '✓';
              btn.classList.add('success');
            } else {
              btn.innerHTML = '✗';
              btn.classList.add('error');
            }
            setTimeout(() => {
              btn.disabled = false;
              btn.classList.remove('success', 'error');
              btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>`;
            }, 2000);
          });
        } catch (e) {
          btn.innerHTML = '✗';
          btn.classList.add('error');
        }
      });

      voiceList.appendChild(item);
    });
  }

  function showInactive(message) {
    if (statusIndicator) statusIndicator.className = 'status-indicator inactive';
    if (statusText) statusText.textContent = message;
    if (counterSection) counterSection.style.display = 'none';
    if (downloadAllBtn) downloadAllBtn.disabled = true;
    if (voiceListContainer) voiceListContainer.style.display = 'none';
  }

  if (downloadAllBtn) {
    downloadAllBtn.addEventListener('click', () => {
      downloadAllBtn.classList.add('downloading');
      const span = downloadAllBtn.querySelector('span');
      if (span) span.textContent = 'Скачиваю...';

      try {
        chrome.runtime.sendMessage({ action: 'downloadAllVoices' }, (response) => {
          downloadAllBtn.classList.remove('downloading');
          if (span) {
            if (response?.success) {
              span.textContent = `Скачано ${response.downloaded}!`;
            } else {
              span.textContent = response?.error || 'Ошибка';
            }
            setTimeout(() => {
              span.textContent = 'Скачать все';
            }, 2500);
          }
        });
      } catch (e) {
        downloadAllBtn.classList.remove('downloading');
        if (span) span.textContent = 'Ошибка';
      }
    });
  }

  if (rescanBtn) {
    rescanBtn.addEventListener('click', () => {
      if (statusIndicator) statusIndicator.className = 'status-indicator searching';
      if (statusText) statusText.textContent = 'Повторный поиск...';

      safeQueryTab((tab) => {
        if (tab && tab.id) {
          try {
            chrome.tabs.sendMessage(tab.id, { action: 'rescan' }, (response) => {
              if (chrome.runtime.lastError) {
                showInactive('Обновите страницу ВК (F5)');
                return;
              }
              updateUI(response?.voices || []);
            });
          } catch (e) {
            showInactive('Обновите страницу ВК');
          }
        }
      });
    });
  }

  function pluralize(n) {
    const abs = Math.abs(n) % 100;
    const lastDigit = abs % 10;
    if (abs >= 11 && abs <= 19) return 'голосовых';
    if (lastDigit === 1) return 'голосовое';
    if (lastDigit >= 2 && lastDigit <= 4) return 'голосовых';
    return 'голосовых';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[m]);
  }

  initPopup();
});
