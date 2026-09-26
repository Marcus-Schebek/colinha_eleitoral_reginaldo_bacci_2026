const TSE_IMAGE_BASE = 'https://divulgacandcontas.tse.jus.br/divulga/rest/arquivo/img';
const ELEICAO_ID = 20322002026;
const REQUEST_TIMEOUT_MS = 15000;

const TSE_HEADERS = {
  Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
  Referer: 'https://divulgacandcontas.tse.jus.br/divulga/',
  Origin: 'https://divulgacandcontas.tse.jus.br',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function query(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  const protocol = req.headers?.['x-forwarded-proto'] || 'http';
  const host = req.headers?.host || 'localhost';
  const parsed = new URL(req.url || '/', `${protocol}://${host}`);
  return Object.fromEntries(parsed.searchParams.entries());
}

function normalize(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function isSafeId(value) {
  return /^[A-Za-z0-9_-]{1,80}$/.test(String(value || ''));
}

async function fetchTSE(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: 'GET',
      headers: TSE_HEADERS,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'GET') {
    return res.status(405).send('Método não permitido.');
  }

  const params = query(req);
  const id = String(params.id == null ? '' : params.id).trim();
  const uf = normalize(params.uf || 'RS');
  const office = normalize(params.office);

  if (!id || !isSafeId(id)) {
    return res.status(400).send('ID de candidato inválido.');
  }

  const municipio = office === 'PRESIDENTE' ? 'BR' : uf;

  if (municipio !== 'RS' && municipio !== 'BR') {
    return res.status(400).send('Localidade não suportada.');
  }

  const tseUrl =
    `${TSE_IMAGE_BASE}/${ELEICAO_ID}/` +
    `${encodeURIComponent(id)}/${municipio}`;

  try {
    console.log('[TSE FOTO] consultando:', tseUrl);

    const response = await fetchTSE(tseUrl);

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      console.error('[TSE FOTO] HTTP', response.status, body.slice(0, 2000));

      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(response.status).send(body || `TSE HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const arrayBuffer = await response.arrayBuffer();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    return res.status(200).send(Buffer.from(arrayBuffer));
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    const detail = isTimeout
      ? `Timeout ao consultar a foto no TSE após ${REQUEST_TIMEOUT_MS} ms.`
      : error?.message || String(error);

    console.error('[TSE FOTO] exceção:', error);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(502).send(detail);
  }
};
