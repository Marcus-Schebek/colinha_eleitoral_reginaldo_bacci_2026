const TSE_BASE = 'https://divulgacandcontas.tse.jus.br/divulga/rest/v1';
const ANO = 2026;
const ELEICAO_ID = 20322002026;
const REQUEST_TIMEOUT_MS = 15000;

const OFFICE_CARGO_CODE = {
  PRESIDENTE: 1,
  GOVERNADOR: 3,
  SENADOR: 5,
  DEPUTADO_FEDERAL: 6,
  DEPUTADO_ESTADUAL: 7,
};

const TSE_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
  Referer: 'https://divulgacandcontas.tse.jus.br/divulga/',
  Origin: 'https://divulgacandcontas.tse.jus.br',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function normalize(value) {
  return String(value == null ? '' : value).trim().toUpperCase();
}

function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;

  const protocol = req.headers?.['x-forwarded-proto'] || 'http';
  const host = req.headers?.host || 'localhost';
  const parsed = new URL(req.url || '/', `${protocol}://${host}`);

  return Object.fromEntries(parsed.searchParams.entries());
}

function getMunicipio(office, uf) {
  return office === 'PRESIDENTE' ? 'BR' : uf;
}

function getCandidateId(candidate) {
  return (
    candidate?.id ??
    candidate?.idCandidato ??
    candidate?.codigoCandidato ??
    candidate?.sqCandidato ??
    candidate?.sequencialCandidato ??
    null
  );
}

function getCandidateName(match, details) {
  return (
    details?.nomeUrna ??
    details?.candidato?.nomeUrna ??
    match?.nomeUrna ??
    match?.nomeCompleto ??
    details?.nomeCompleto ??
    details?.candidato?.nomeCompleto ??
    null
  );
}

function getParty(match, details) {
  const party =
    details?.partido ??
    details?.candidato?.partido ??
    match?.partido ??
    null;

  return {
    number: party?.numero ?? null,
    acronym: party?.sigla ?? null,
    name: party?.nome ?? null,
  };
}

async function fetchTSE(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function responseText(response) {
  try {
    return await response.text();
  } catch (_) {
    return '';
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  res.status(status);
  Object.entries(extraHeaders).forEach(([key, value]) => res.setHeader(key, value));
  res.json(payload);
}

module.exports = async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  };

  Object.entries(headers).forEach(([key, value]) => res.setHeader(key, value));

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      found: false,
      error: 'Método não permitido.',
    });
  }

  try {
    const query = getQuery(req);
    const uf = normalize(query.uf);
    const office = normalize(query.office);
    const number = String(query.number == null ? '' : query.number).trim();

    if (!uf || !office || !number) {
      return sendJson(res, 400, {
        found: false,
        error: 'Parâmetros uf, office e number são obrigatórios.',
      });
    }

    if (uf !== 'RS') {
      return sendJson(res, 200, {
        found: false,
        source: 'validation',
        error: 'Esta ferramenta consulta apenas candidatos do Rio Grande do Sul.',
      });
    }

    const cargoCode = OFFICE_CARGO_CODE[office];
    if (!cargoCode) {
      return sendJson(res, 200, {
        found: false,
        source: 'validation',
        error: `Cargo "${office}" não reconhecido.`,
      });
    }

    const municipio = getMunicipio(office, uf);
    const listUrl =
      `${TSE_BASE}/candidatura/listar/${ANO}/${municipio}/` +
      `${ELEICAO_ID}/${cargoCode}/candidatos`;

    console.log('[TSE LOOKUP] consultando:', listUrl);

    const response = await fetchTSE(listUrl, {
      method: 'GET',
      headers: TSE_HEADERS,
    });

    if (!response.ok) {
      const body = await responseText(response);
      console.error('[TSE LOOKUP] HTTP', response.status, body.slice(0, 2000));

      return sendJson(res, response.status, {
        found: false,
        source: 'tse',
        tseStatus: response.status,
        tseUrl: listUrl,
        error: body || `TSE HTTP ${response.status}`,
        tseError: body || `TSE HTTP ${response.status}`,
      });
    }

    const data = await response.json();
    const candidates = Array.isArray(data?.candidatos) ? data.candidatos : [];

    const match = candidates.find((candidate) => {
      const candidateNumber = String(
        candidate?.numero ?? candidate?.numeroCandidato ?? ''
      ).trim();
      return candidateNumber === number;
    });

    if (!match) {
      return sendJson(res, 200, {
        found: false,
        source: 'tse',
        uf,
        office,
        number,
      });
    }

    const candidateId = getCandidateId(match);
    let details = null;

    if (candidateId) {
      const detailUrl =
        `${TSE_BASE}/candidatura/buscar/${ANO}/${municipio}/` +
        `${ELEICAO_ID}/candidato/${encodeURIComponent(String(candidateId))}`;

      try {
        const detailResponse = await fetchTSE(detailUrl, {
          method: 'GET',
          headers: TSE_HEADERS,
        });

        if (detailResponse.ok) {
          details = await detailResponse.json();
        } else {
          const detailBody = await responseText(detailResponse);
          console.warn(
            '[TSE LOOKUP] detalhe HTTP',
            detailResponse.status,
            detailBody.slice(0, 500)
          );
        }
      } catch (detailError) {
        console.warn('[TSE LOOKUP] falha no detalhe:', detailError?.message || detailError);
      }
    }

    const photoUrl = candidateId
      ? `/api/candidates/photo?id=${encodeURIComponent(String(candidateId))}` +
        `&uf=${encodeURIComponent(uf)}&office=${encodeURIComponent(office)}`
      : null;

    return sendJson(res, 200, {
      found: true,
      source: 'tse',
      uf,
      office,
      number:
        details?.numero ??
        details?.candidato?.numero ??
        match?.numero ??
        number,
      name: getCandidateName(match, details),
      party: getParty(match, details),
      status:
        details?.descricaoSituacao ??
        details?.candidato?.descricaoSituacao ??
        match?.descricaoSituacao ??
        null,
      candidateId,
      photoUrl,
    });
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    const detail = isTimeout
      ? `Timeout ao consultar o TSE após ${REQUEST_TIMEOUT_MS} ms.`
      : error?.message || String(error);

    console.error('[TSE LOOKUP] exceção:', error);

    return sendJson(res, 502, {
      found: false,
      source: 'tse',
      tseStatus: 0,
      error: detail,
      tseError: detail,
    });
  }
};
