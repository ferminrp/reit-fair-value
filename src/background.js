const API_URL = 'https://reit.com.ar/api/metricas';
const CACHE_TTL_MS = 5 * 60 * 1000;

let cache = null;

function pickMetric(source, key) {
  const item = source?.[key];
  if (!item) return null;
  return {
    valor: item.valor,
    formato: item.formato ?? String(item.valor),
  };
}

async function fetchMetricas() {
  const response = await fetch(API_URL);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = await response.json();
  const source = data?.metricas;

  if (!source?.fair_value?.valor) {
    throw new Error('Fair value no encontrado en la respuesta');
  }

  const metricas = {
    patrimonio_fondo: pickMetric(source, 'patrimonio_fondo'),
    activos_financieros: pickMetric(source, 'activos_financieros'),
    valor_propiedades: pickMetric(source, 'valor_propiedades'),
    inmuebles: pickMetric(source, 'inmuebles'),
    fair_value: pickMetric(source, 'fair_value'),
    ocupacion: pickMetric(source, 'ocupacion'),
    fecha_actualizacion: pickMetric(source, 'fecha_actualizacion'),
    evolucion_mensual: pickMetric(source, 'evolucion_mensual'),
    rendimiento_anual: pickMetric(source, 'rendimiento_anual'),
    rendimiento_lanzamiento: pickMetric(source, 'rendimiento_lanzamiento'),
  };

  return {
    metricas,
    actualizado: data.actualizado || null,
    fetchedAt: Date.now(),
  };
}

async function getMetricas(forceRefresh = false) {
  if (
    !forceRefresh &&
    cache &&
    Date.now() - cache.fetchedAt < CACHE_TTL_MS
  ) {
    return cache;
  }

  const result = await fetchMetricas();
  cache = result;
  return result;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== 'GET_FAIR_VALUE') {
    return false;
  }

  getMetricas(Boolean(message.forceRefresh))
    .then((data) => sendResponse({ ok: true, data }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));

  return true;
});
