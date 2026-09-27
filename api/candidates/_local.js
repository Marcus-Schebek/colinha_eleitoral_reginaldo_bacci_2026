const fs = require('fs');
const path = require('path');

const OFFICE_CARGO_CODE = {
  PRESIDENTE: '1',
  GOVERNADOR: '3',
  SENADOR: '5',
  DEPUTADO_FEDERAL: '6',
  DEPUTADO_ESTADUAL: '7',
};

const CARGO_OFFICE = Object.fromEntries(
  Object.entries(OFFICE_CARGO_CODE).map(([office, code]) => [code, office])
);

const DATA_FILES = {
  RS: [
    path.join(process.cwd(), 'consulta_cand_2026_RS.csv'),
    path.join(process.cwd(), 'data', 'consulta_cand_2026_RS.csv'),
  ],
  BR: [
    path.join(process.cwd(), 'consulta_cand_2026_BR.csv'),
    path.join(process.cwd(), 'data', 'consulta_cand_2026_BR.csv'),
  ],
};

const cache = new Map();

function normalize(value) {
  return String(value == null ? '' : value)
    .trim()
    .toUpperCase();
}

/**
 * CSV do TSE usa ; como separador e campos entre aspas.
 * Este parser trata aspas escapadas ("") e ; dentro de campos.
 */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ';') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      field = '';
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    if (row.some((value) => value !== '')) rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows[0].map(normalize);
  return rows.slice(1).map((values) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = values[index] ?? '';
    });
    return item;
  });
}

function findDataFile(uf) {
  const candidates = DATA_FILES[uf] || [];
  return candidates.find((file) => fs.existsSync(file)) || null;
}

function loadIndex(uf) {
  const normalizedUf = normalize(uf);
  if (cache.has(normalizedUf)) return cache.get(normalizedUf);

  const file = findDataFile(normalizedUf);
  if (!file) {
    throw new Error(
      `CSV local não encontrado para ${normalizedUf}. ` +
      `Esperado: ${DATA_FILES[normalizedUf]?.join(' ou ') || 'UF não suportada'}.`
    );
  }

  const text = fs.readFileSync(file, 'latin1');
  const rows = parseCsv(text);

  const byOfficeAndNumber = new Map();
  const byCandidateId = new Map();

  for (const row of rows) {
    const ufRow = normalize(row.SG_UF);
    const cargoCode = normalize(row.CD_CARGO);
    const number = String(row.NR_CANDIDATO || '').trim();
    const candidateId = String(row.SQ_CANDIDATO || '').trim();

    if (!candidateId || !number || !cargoCode) continue;
    if (ufRow !== normalizedUf) continue;

    const office = CARGO_OFFICE[cargoCode];
    if (!office) continue;

    const candidate = {
      uf: ufRow,
      office,
      number,
      name:
        row.NM_URNA_CANDIDATO ||
        row.NM_SOCIAL_CANDIDATO ||
        row.NM_CANDIDATO ||
        null,
      fullName: row.NM_CANDIDATO || null,
      party: {
        number: row.NR_PARTIDO || null,
        acronym: row.SG_PARTIDO || null,
        name: row.NM_PARTIDO || null,
      },
      status: row.DS_SITUACAO_CANDIDATURA || null,
      candidateId,
      sqCandidate: candidateId,
    };

    // Mesma estratégia de Map usada pela implementação da Juliana:
    // se houver duplicidade, o último registro indexado prevalece.
    byOfficeAndNumber.set(`${office}:${number}`, candidate);
    byCandidateId.set(candidateId, candidate);
  }

  const result = {
    file,
    rows: rows.length,
    byOfficeAndNumber,
    byCandidateId,
  };

  cache.set(normalizedUf, result);
  return result;
}

function lookupCandidate(office, number, uf = 'RS') {
  const normalizedOffice = normalize(office);
  const normalizedUf = normalize(uf);
  const normalizedNumber = String(number == null ? '' : number).trim();

  if (!normalizedUf || !normalizedOffice || !normalizedNumber) {
    return {
      found: false,
      source: 'validation',
      error: 'Parâmetros uf, office e number são obrigatórios.',
    };
  }

  if (!OFFICE_CARGO_CODE[normalizedOffice]) {
    return {
      found: false,
      source: 'validation',
      error: `Cargo "${normalizedOffice}" não reconhecido.`,
    };
  }

  if (!DATA_FILES[normalizedUf]) {
    return {
      found: false,
      source: 'validation',
      error: `UF "${normalizedUf}" não suportada pela base local.`,
    };
  }

  const index = loadIndex(normalizedUf);
  const candidate = index.byOfficeAndNumber.get(
    `${normalizedOffice}:${normalizedNumber}`
  );

  if (!candidate) {
    return {
      found: false,
      source: 'local',
      uf: normalizedUf,
      office: normalizedOffice,
      number: normalizedNumber,
    };
  }

  const photoUrl =
    `/api/candidates/photo?id=${encodeURIComponent(candidate.candidateId)}` +
    `&uf=${encodeURIComponent(candidate.uf)}`;

  return {
    found: true,
    source: 'local',
    uf: candidate.uf,
    office: candidate.office,
    number: candidate.number,
    name: candidate.name,
    fullName: candidate.fullName,
    party: candidate.party,
    status: candidate.status,
    candidateId: candidate.candidateId,
    photoUrl,
  };
}

function findCandidateById(id, uf = 'RS') {
  const normalizedUf = normalize(uf);
  if (!DATA_FILES[normalizedUf]) return null;

  const index = loadIndex(normalizedUf);
  return index.byCandidateId.get(String(id || '').trim()) || null;
}

function clearCache() {
  cache.clear();
}

module.exports = {
  OFFICE_CARGO_CODE,
  normalize,
  loadIndex,
  lookupCandidate,
  findCandidateById,
  clearCache,
};
