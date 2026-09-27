const {
  lookupCandidate,
  getEffectiveUf,
} = require('./_local');

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;

  const protocol = req.headers?.['x-forwarded-proto'] || 'http';
  const host = req.headers?.host || 'localhost';
  const parsed = new URL(req.url || '/', `${protocol}://${host}`);

  return Object.fromEntries(parsed.searchParams.entries());
}

function sendJson(res, status, payload) {
  res.status(status);
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
  return res.json(payload);
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return sendJson(res, 405, {
      found: false,
      error: 'Método não permitido.',
    });
  }

  try {
    const query = getQuery(req);
    const office = String(query.office || '').trim();
    const uf = getEffectiveUf(office, String(query.uf || 'RS').trim());
    const number = String(query.number == null ? '' : query.number).trim();

    const candidate = lookupCandidate(office, number, uf);

    // Erro de configuração/base local.
    if (candidate.found === false && candidate.source !== 'local' && candidate.source !== 'validation') {
      return sendJson(res, 500, candidate);
    }

    return sendJson(res, 200, candidate);
  } catch (error) {
    console.error('[LOCAL LOOKUP] erro:', error);

    return sendJson(res, 500, {
      found: false,
      source: 'local',
      error: error?.message || String(error),
    });
  }
};
