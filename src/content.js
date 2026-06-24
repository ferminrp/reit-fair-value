(function () {
  'use strict';

  const PRICE_WAIT_TIMEOUT_MS = 30000;
  const OBSERVER_DEBOUNCE_MS = 300;
  const FAIR_VALUE_REFRESH_MS = 5 * 60 * 1000;

  let broker = null;
  let metricsData = null;
  let modal = null;
  let observer = null;
  let debounceTimer = null;
  let priceWaitTimer = null;
  let refreshTimer = null;
  let pricePollTimer = null;

  function storageKeyPosition() {
    return `modalPosition:${broker?.id || 'default'}`;
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

  function formatPatrimonioPct(value, patrimonio) {
    if (!patrimonio || patrimonio <= 0) return null;
    const pct = (value / patrimonio) * 100;
    return `${pct.toFixed(1).replace('.', ',')}%`;
  }

  function metricValue(metric) {
    if (!metric) return '—';
    return metric.formato || String(metric.valor);
  }

  function renderMetricRow(label, value) {
    return `
      <div class="rfv-row">
        <span class="rfv-label">${label}</span>
        <span class="rfv-value rfv-value--metric">${value}</span>
      </div>
    `;
  }

  function renderMetricsSection(metricas) {
    const patrimonio = metricas.patrimonio_fondo?.valor ?? 0;

    return `
      <div class="rfv-section">
        <div class="rfv-section-title">Métricas del fondo</div>
        ${renderMetricRow('Patrimonio', metricValue(metricas.patrimonio_fondo))}
        ${renderMetricRow(
          'Activos financieros',
          `${metricValue(metricas.activos_financieros)}${
            patrimonio
              ? ` <span class="rfv-pct">(${formatPatrimonioPct(metricas.activos_financieros?.valor ?? 0, patrimonio)} del patrimonio)</span>`
              : ''
          }`
        )}
        ${renderMetricRow(
          'Valor inmuebles',
          `${metricValue(metricas.valor_propiedades)}${
            patrimonio
              ? ` <span class="rfv-pct">(${formatPatrimonioPct(metricas.valor_propiedades?.valor ?? 0, patrimonio)} del patrimonio)</span>`
              : ''
          }`
        )}
        ${renderMetricRow('Ocupación', metricValue(metricas.ocupacion))}
        ${renderMetricRow('Evolución mensual', metricValue(metricas.evolucion_mensual))}
        ${renderMetricRow('Rendimiento anual', metricValue(metricas.rendimiento_anual))}
        ${renderMetricRow(
          'Rend. lanzamiento',
          metricValue(metricas.rendimiento_lanzamiento)
        )}
      </div>
    `;
  }

  function readMarketPrice() {
    return broker?.readMarketPrice() ?? null;
  }

  function getComparison(marketPrice, fairValue) {
    const diff = marketPrice - fairValue;
    const diffPct = (diff / fairValue) * 100;

    let statusClass;
    let statusText;

    if (diff > 0) {
      statusClass = 'rfv-status--above';
      statusText = 'Por encima del fair value';
    } else if (diff < 0) {
      statusClass = 'rfv-status--below';
      statusText = 'Por debajo del fair value';
    } else {
      statusClass = 'rfv-status--equal';
      statusText = 'En fair value';
    }

    const diffText = `${formatDiff(diff)} · ${formatPct(diffPct)}`;

    return { statusClass, statusText, diffText };
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

  async function loadMetrics(forceRefresh = false) {
    const response = await requestFairValue(forceRefresh);
    if (!response?.ok) {
      metricsData = null;
      return false;
    }
    metricsData = response.data;
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
      const ok = await loadMetrics(true);
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
    if (!metricsData?.metricas?.fair_value) {
      renderFairValueError();
      return;
    }

    const marketPrice = readMarketPrice();
    if (marketPrice === null) {
      renderLoading();
      return;
    }

    stopPricePolling();

    const fairValue = metricsData.metricas.fair_value.valor;
    const { statusClass, statusText, diffText } = getComparison(
      marketPrice,
      fairValue
    );

    const el = ensureModal();
    const fecha = metricsData.metricas.fecha_actualizacion?.formato
      ? `Datos al ${metricsData.metricas.fecha_actualizacion.formato}`
      : '';

    el.querySelector('.rfv-body').innerHTML = `
      <div class="rfv-status ${statusClass}">${statusText}</div>
      <div class="rfv-row">
        <span class="rfv-label">Precio mercado</span>
        <span class="rfv-value">${formatARS(marketPrice)}</span>
      </div>
      <div class="rfv-row">
        <span class="rfv-label">Fair value</span>
        <span class="rfv-value">${formatARS(fairValue)}</span>
      </div>
      <div class="rfv-diff">${diffText}</div>
      ${renderMetricsSection(metricsData.metricas)}
      ${fecha ? `<div class="rfv-meta">${fecha}</div>` : ''}
      ${broker ? `<div class="rfv-meta">${broker.name}</div>` : ''}
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
        [storageKeyPosition()]: { left: rect.left, top: rect.top },
      });
    }

    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);
  }

  function restorePosition(modalEl) {
    chrome.storage.local.get(storageKeyPosition(), (result) => {
      const pos = result[storageKeyPosition()];
      if (pos?.left != null && pos?.top != null) {
        modalEl.style.right = 'auto';
        modalEl.style.left = `${pos.left}px`;
        modalEl.style.top = `${pos.top}px`;
      }
    });
  }

  function startPriceObserver() {
    if (observer) observer.disconnect();

    const target = broker.getObserverTarget();

    observer = new MutationObserver(() => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(updateUI, OBSERVER_DEBOUNCE_MS);
    });

    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  }

  function startPricePolling() {
    clearInterval(pricePollTimer);
    pricePollTimer = setInterval(() => {
      if (readMarketPrice() !== null) {
        clearInterval(pricePollTimer);
        pricePollTimer = null;
        updateUI();
      }
    }, 500);
  }

  function stopPricePolling() {
    if (pricePollTimer) {
      clearInterval(pricePollTimer);
      pricePollTimer = null;
    }
  }

  function startPriceWaitTimeout() {
    clearTimeout(priceWaitTimer);
    priceWaitTimer = setTimeout(() => {
      stopPricePolling();
      if (readMarketPrice() === null) {
        renderPriceError();
      }
    }, PRICE_WAIT_TIMEOUT_MS);
  }

  function startFairValueRefresh() {
    clearInterval(refreshTimer);
    refreshTimer = setInterval(async () => {
      await loadMetrics(true);
      updateUI();
    }, FAIR_VALUE_REFRESH_MS);
  }

  async function init() {
    broker = window.RFV_getBroker();
    if (!broker) return;

    renderLoading('Obteniendo fair value...');

    const fairOk = await loadMetrics();
    if (!fairOk) {
      renderFairValueError();
      return;
    }

    renderLoading();
    startPriceObserver();
    startPricePolling();
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
