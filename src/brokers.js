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

  function normalizeText(text) {
    return text.replace(/\s+/g, ' ').trim();
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
      return document.body;
    },
    _findPriceElement() {
      for (const label of document.querySelectorAll('p')) {
        if (!/último\s+operado/i.test(normalizeText(label.textContent))) {
          continue;
        }

        const sibling = label.nextElementSibling;
        const priceSpan =
          sibling?.querySelector('span[class*="text-size-6"]') ||
          sibling?.querySelector('span');

        if (priceSpan && /\$?\s*[\d.]+,\d{2}/.test(priceSpan.textContent)) {
          return priceSpan;
        }

        const container = label.parentElement;
        const nestedSpan = container?.querySelector('span[class*="text-size-6"]');
        if (nestedSpan && /\$?\s*[\d.]+,\d{2}/.test(nestedSpan.textContent)) {
          return nestedSpan;
        }
      }

      for (const span of document.querySelectorAll('span[class*="text-size-6"]')) {
        const text = normalizeText(span.textContent);
        if (/^\$\s*[\d.]+,\d{2}$/.test(text)) {
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

  const iol = {
    id: 'iol',
    name: 'IOL',
    matches() {
      if (!/iol\.invertironline\.com$/i.test(location.hostname)) return false;
      return /\/titulo\/cotizacion\/BCBA\/REIT/i.test(location.pathname);
    },
    getObserverTarget() {
      return (
        document.querySelector('[data-field="UltimoPrecio"]')?.closest('table') ||
        document.body
      );
    },
    readMarketPrice() {
      const priceEl = document.querySelector('[data-field="UltimoPrecio"]');
      if (!priceEl) return null;
      return parseSingleArgentinePrice(priceEl.textContent);
    },
  };

  const cocos = {
    id: 'cocos',
    name: 'Cocos Capital',
    matches() {
      if (!/app\.cocos\.capital$/i.test(location.hostname)) return false;
      return /^\/market\//i.test(location.pathname);
    },
    getObserverTarget() {
      const drawer = document.querySelector('[class*="_selectedInstrument_"]');
      return drawer?.parentElement || document.body;
    },
    getWaitingMessage() {
      return 'Seleccioná REIT en el listado';
    },
    skipPriceWaitTimeout: true,
    _isReitSelected() {
      const drawer = document.querySelector('[class*="_selectedInstrument_"]');
      if (!drawer) return false;

      const titleEl = drawer.querySelector('[class*="_instrumentTitle_"]');
      if (!titleEl) return false;

      return /REIT/i.test(normalizeText(titleEl.textContent));
    },
    _findPriceParts() {
      const drawer = document.querySelector('[class*="_selectedInstrument_"]');
      if (!drawer) return null;

      const intEl = drawer.querySelector('[class*="_integerPart_"]');
      const decEl = drawer.querySelector('[class*="_decimalPart_"]');
      if (!intEl || !decEl) return null;

      return { intEl, decEl };
    },
    readMarketPrice() {
      if (!this._isReitSelected()) return null;

      const parts = this._findPriceParts();
      if (!parts) return null;

      const intPart = normalizeText(parts.intEl.textContent).replace(/,\s*$/, '');
      const decPart = normalizeText(parts.decEl.textContent);
      if (!intPart || !decPart) return null;

      return parseArgentineParts(intPart, `,${decPart.padEnd(2, '0')}`);
    },
  };

  const ppi = {
    id: 'ppi',
    name: 'PPI',
    matches() {
      if (!/trading\.portfoliopersonal\.com$/i.test(location.hostname)) return false;
      return /\/Cotizaciones\/Item\/925077/i.test(location.pathname);
    },
    _findPriceElement() {
      const fciPrice = document.querySelector('[class*="lastPriceValue"]');
      if (fciPrice && /[\d.]+,\d{2}/.test(fciPrice.textContent)) {
        return fciPrice;
      }

      for (const selector of [
        '.font-highlight-lg.font-bold',
        '.font-highlight-md.font-bold',
        '.font-highlight-sm.font-bold',
      ]) {
        for (const el of document.querySelectorAll(selector)) {
          const text = normalizeText(el.textContent);
          if (/AR\$\s*[\d.]+,\d{2}/.test(text)) {
            return el;
          }
        }
      }

      for (const label of document.querySelectorAll('.font-body-sm, .font-body-md')) {
        if (!/último precio/i.test(normalizeText(label.textContent))) continue;

        const priceEl =
          label.querySelector('[class*="lastPriceValue"]') ||
          label.querySelector('span');

        if (priceEl && /[\d.]+,\d{2}/.test(priceEl.textContent)) {
          return priceEl;
        }
      }

      return null;
    },
    getObserverTarget() {
      const priceEl = this._findPriceElement();
      return (
        priceEl?.closest('[class*="detailFCI"]') ||
        priceEl?.parentElement ||
        document.body
      );
    },
    readMarketPrice() {
      const priceEl = this._findPriceElement();
      if (!priceEl) return null;
      return parseSingleArgentinePrice(priceEl.textContent);
    },
  };

  window.RFV_BROKERS = [iebmas, balanz, iol, ppi, cocos];

  window.RFV_getBroker = function () {
    return window.RFV_BROKERS.find((broker) => broker.matches()) || null;
  };
})();
