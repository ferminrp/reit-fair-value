(function () {
  'use strict';

  const PRICE_WAIT_TIMEOUT_MS = 30000;
  const OBSERVER_DEBOUNCE_MS = 300;
  const FAIR_VALUE_REFRESH_MS = 5 * 60 * 1000;
  const STORAGE_KEY_POSITION = 'modalPosition';

  let fairValueData = null;
  let modal = null;
  let observer = null;
  let debounceTimer = null;
  let priceWaitTimer = null;
  let refreshTimer = null;

  function parseArgentinePrice(intText, decText) {
    const integer = intText.replace(/\./g, '').trim();
    const decimal = decText.replace(',', '.').trim();
    if (!integer) return null;
    const value = Number(`${integer}${decimal}`);
    return Number.isFinite(value) ? value : null;
  }

  function formatARS(value) {
    const formatted = new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value));
    const sign = value < 0 ? '-' : '';
    return `${sign}ARS ${formatted}`;
  }

  function formatDiff(value) {
    const formatted = new Intl.NumberFormat('es-AR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(Math.abs(value));
    const sign = value > 0 ? '+' : value < 0 ? '-' : '';
    return `${sign}ARS ${formatted}`;
  }

  function formatPct(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${value.toFixed(2).replace('.', ',')}%`;
  }

  function isReitPage() {
    return /\/instrumento\/REIT/i.test(location.pathname);
  }

  function findPriceElements() {
    const displayNumber = document.querySelector('.display-number');
    if (!displayNumber) return null;

    const intEl = displayNumber.querySelector('[class*="labelXxlBold"]');
    if (intEl) {
      const decEl = intEl.nextElementSibling;
      if (decEl?.tagName === 'SPAN') {
        return { intEl, decEl };
      }
    }

    const boxes = displayNumber.querySelectorAll('div');
    for (const box of boxes) {
      const spans = box.querySelectorAll(':scope > span');
      if (spans.length >= 2) {
        return { intEl: spans[0], decEl: spans[1] };
      }
    }

    return null;
  }

  function readMarketPrice() {
    const els = findPriceElements();
    if (!els) return null;
    return parseArgentinePrice(els.intEl.textContent, els.decEl.textContent);
  }

  function getComparison(marketPrice, fairValue) {
    const diff = marketPrice - fairValue;
    const diffPct = (diff / fairValue) * 100;

    let status;
    let statusClass;
    let statusText;

    if (diff > 0) {
      status = 'above';
      statusClass = 'rfv-status--above';
      statusText = 'Por encima del fair value';
    } else if (diff < 0) {
      status = 'below';
      statusClass = 'rfv-status--below';
      statusText = 'Por debajo del fair value';
    } else {
      status = 'equal';
      statusClass = 'rfv-status--equal';
      statusText = 'En fair value';
    }

    const diffText = `${formatDiff(diff)} · ${formatPct(diffPct)}`;

    return { status, statusClass, statusText, diffText };
  }

  function requestFairValue(forceRefresh = false) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_FAIR_VALUE', forceRefresh },
        (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response);
        }
      );
    });
  }

  async function loadFairValue(forceRefresh = false) {
    const response = await requestFairValue(forceRefresh);
    if (!response?.ok) {
      fairValueData = null;
      return false;
    }
    fairValueData = response.data;
    return true;
  }

  function ensureModal() {
    if (modal) return modal;

    modal = document.createElement('div');
    modal.id = 'rfv-modal';
    modal.innerHTML = `
      <div class="rfv-header">
        <span class="rfv-title">REIT vs Fair Value</span>
        <div class="rfv-header-actions">
          <button class="rfv-btn rfv-collapse" type="button" title="Colapsar">−</button>
        </div>
      </div>
      <div class="rfv-body"></div>
    `;

    document.body.appendChild(modal);
    setupDrag(modal);
    setupCollapse(modal);
    restorePosition(modal);

    return modal;
  }

  function renderLoading(message = 'Esperando precio...') {
    const el = ensureModal();
    el.querySelector('.rfv-body').innerHTML = `
      <div class="rfv-loading">
        <div class="rfv-spinner"></div>
        <span>${message}</span>
      </div>
    `;
  }

  function renderFairValueError() {
    const el = ensureModal();
    el.querySelector('.rfv-body').innerHTML = `
      <div class="rfv-error">
        <span>No se pudo obtener fair value</span>
      </div>
      <button class="rfv-retry" type="button">Reintentar</button>
    `;
    el.querySelector('.rfv-retry').addEventListener('click', async () => {
      renderLoading('Obteniendo fair value...');
      const ok = await loadFairValue(true);
      if (ok) {
        updateUI();
      } else {
        renderFairValueError();
      }
    });
  }

  function renderPriceError() {
    const el = ensureModal();
    el.querySelector('.rfv-body').innerHTML = `
      <div class="rfv-error">
        <span>No se encontró el precio en la página</span>
      </div>
    `;
  }

  function updateUI() {
    if (!fairValueData) {
      renderFairValueError();
      return;
    }

    const marketPrice = readMarketPrice();
    if (marketPrice === null) {
      renderLoading();
      return;
    }

    const { statusClass, statusText, diffText } = getComparison(
      marketPrice,
      fairValueData.valor
    );

    const el = ensureModal();
    const fecha = fairValueData.fechaActualizacion
      ? `Fair value al ${fairValueData.fechaActualizacion}`
      : '';

    el.querySelector('.rfv-body').innerHTML = `
      <div class="rfv-status ${statusClass}">${statusText}</div>
      <div class="rfv-row">
        <span class="rfv-label">Precio mercado</span>
        <span class="rfv-value">${formatARS(marketPrice)}</span>
      </div>
      <div class="rfv-row">
        <span class="rfv-label">Fair value</span>
        <span class="rfv-value">${formatARS(fairValueData.valor)}</span>
      </div>
      <div class="rfv-diff">${diffText}</div>
      ${fecha ? `<div class="rfv-meta">${fecha}</div>` : ''}
    `;
  }

  function setupCollapse(modalEl) {
    const btn = modalEl.querySelector('.rfv-collapse');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      modalEl.classList.toggle('rfv-collapsed');
      btn.textContent = modalEl.classList.contains('rfv-collapsed') ? '+' : '−';
    });
  }

  function setupDrag(modalEl) {
    const header = modalEl.querySelector('.rfv-header');
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    function onPointerDown(e) {
      if (e.target.closest('.rfv-btn')) return;

      dragging = true;
      modalEl.classList.add('rfv-dragging');

      const rect = modalEl.getBoundingClientRect();
      modalEl.style.right = 'auto';
      modalEl.style.left = `${rect.left}px`;
      modalEl.style.top = `${rect.top}px`;

      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;

      header.setPointerCapture(e.pointerId);
      e.preventDefault();
    }

    function onPointerMove(e) {
      if (!dragging) return;

      const dx = e.clientX - startX;
      const dy = e.clientY - startY;

      modalEl.style.left = `${startLeft + dx}px`;
      modalEl.style.top = `${startTop + dy}px`;
    }

    function onPointerUp(e) {
      if (!dragging) return;

      dragging = false;
      modalEl.classList.remove('rfv-dragging');
      header.releasePointerCapture(e.pointerId);

      const rect = modalEl.getBoundingClientRect();
      chrome.storage.local.set({
        [STORAGE_KEY_POSITION]: { left: rect.left, top: rect.top },
      });
    }

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
  }

  function restorePosition(modalEl) {
    chrome.storage.local.get(STORAGE_KEY_POSITION, (result) => {
      const pos = result[STORAGE_KEY_POSITION];
      if (pos?.left != null && pos?.top != null) {
        modalEl.style.right = 'auto';
        modalEl.style.left = `${pos.left}px`;
        modalEl.style.top = `${pos.top}px`;
      }
    });
  }

  function startPriceObserver() {
    if (observer) observer.disconnect();

    const target = document.querySelector('.display-number') || document.body;

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateUI, OBSERVER_DEBOUNCE_MS);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function startPriceWaitTimeout() {
    clearTimeout(priceWaitTimer);
    priceWaitTimer = setTimeout(() => {
      if (readMarketPrice() === null) {
        renderPriceError();
      }
    }, PRICE_WAIT_TIMEOUT_MS);
  }

  function startFairValueRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      await loadFairValue(true);
      updateUI();
    }, FAIR_VALUE_REFRESH_MS);
  }

  async function init() {
    if (!isReitPage()) return;

    renderLoading('Obteniendo fair value...');

    const fairOk = await loadFairValue();
    if (!fairOk) {
      renderFairValueError();
      return;
    }

    renderLoading();
    startPriceObserver();
    startPriceWaitTimeout();
    startFairValueRefresh();
    updateUI();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
