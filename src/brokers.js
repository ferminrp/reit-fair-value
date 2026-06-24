(function () {
  'use strict';

  function parseArgentineParts(intText, decText) {
    const integer = intText.replace(/\./g, '').trim();
    const decimal = decText.replace(',', '.').trim();
    if (!integer) return null;
    const value = Number(`${integer}${decimal}`);
    return Number.isFinite(value) ? value : null;
  }

  function parseSingleArgentinePrice(text) {
    const match = text.match(/[\d.]+,\d{2}/);
    if (!match) return null;
    const [intPart, decPart] = match[0].split(',');
    return parseArgentineParts(intPart, `,${decPart}`);
  }

  const iebmas = {
    id: 'iebmas',
    name: 'IEB Mas',
    matches() {
      return (
        /hb\.iebmas\.com\.ar$/i.test(location.hostname) &&
        /\/instrumento\/REIT/i.test(location.pathname)
      );
    },
    getObserverTarget() {
      return document.querySelector('.display-number') || document.body;
    },
    readMarketPrice() {
      const displayNumber = document.querySelector('.display-number');
      if (!displayNumber) return null;

      const intEl = displayNumber.querySelector('[class*="labelXxlBold"]');
      if (intEl) {
        const decEl = intEl.nextElementSibling;
        if (decEl?.tagName === 'SPAN') {
          return parseArgentineParts(intEl.textContent, decEl.textContent);
        }
      }

      const boxes = displayNumber.querySelectorAll('div');
      for (const box of boxes) {
        const spans = box.querySelectorAll(':scope > span');
        if (spans.length >= 2) {
          return parseArgentineParts(spans[0].textContent, spans[1].textContent);
        }
      }

      return null;
    },
  };

  const balanz = {
    id: 'balanz',
    name: 'Balanz',
    matches() {
      if (!/clientes\.balanz\.com$/i.test(location.hostname)) return false;
      if (!/\/app\/detalleinstrumento/i.test(location.pathname)) return false;
      const ticker = new URLSearchParams(location.search).get('ticker');
      return ticker?.toUpperCase() === 'REIT';
    },
    getObserverTarget() {
      const priceSpan = this._findPriceElement();
      return priceSpan?.closest('.row') || document.body;
    },
    _findPriceElement() {
      const labels = document.querySelectorAll('p.text-size-3');
      for (const label of labels) {
        if (label.textContent.trim() !== 'Último operado') continue;
        const container = label.parentElement;
        const priceSpan = container?.querySelector('span.text-size-6b');
        if (priceSpan) return priceSpan;
      }

      for (const span of document.querySelectorAll('span.text-size-6b')) {
        const text = span.textContent.trim();
        if (/^\$\s*[\d.]+\,\d{2}$/.test(text)) {
          return span;
        }
      }

      return null;
    },
    readMarketPrice() {
      const priceEl = this._findPriceElement();
      if (!priceEl) return null;
      return parseSingleArgentinePrice(priceEl.textContent);
    },
  };

  window.RFV_BROKERS = [iebmas, balanz];

  window.RFV_getBroker = function () {
    return window.RFV_BROKERS.find((broker) => broker.matches()) || null;
  };
})();
