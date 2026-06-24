const API_URL = 'https://reit.com.ar/api/metricas';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;

async function fetchFairValue() {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const fairValue = data?.metricas?.fair_value;
  const fechaActualizacion = data?.metricas?.fecha_actualizacion;

  if (!fairValue?.valor) {
    throw new Error('Fair value no encontrado en la respuesta');
  }

  return {
    valor: fairValue.valor,
    formato: fairValue.formato || String(fairValue.valor),
    fechaActualizacion: fechaActualizacion?.formato || null,
    actualizado: data.actualizado || null,
    fetchedAt: Date.now(),
  };
}

async function getFairValue(forceRefresh = false) {
  if (
    !forceRefresh &&
    cache &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache;
  }

  const result = await fetchFairValue();
  cache = result;
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_FAIR_VALUE') {
    return false;
  }

  getFairValue(Boolean(message.forceRefresh))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
