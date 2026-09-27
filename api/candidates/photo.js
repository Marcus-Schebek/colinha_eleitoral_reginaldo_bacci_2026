const fs = require('fs');
const path = require('path');

const PHOTO_ROOTS = [
  path.join(process.cwd(), 'public', 'fotos'),
  path.join(process.cwd(), 'public', 'photos'),
  path.join(process.cwd(), 'fotos'),
  path.join(process.cwd(), 'photos'),
];

const EXTENSIONS = ['jpg', 'jpeg', 'JPG', 'JPEG', 'png', 'PNG', 'webp', 'WEBP'];

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

function getEffectiveUf(office, uf = 'RS') {
  return normalize(office) === 'PRESIDENTE'
    ? 'BR'
    : normalize(uf);
}

function isSafeId(value) {
  return /^[0-9A-Za-z_-]{1,80}$/.test(String(value || ''));
}

/**
 * LEIA-ME do TSE:
 * UF + SQ_CANDIDATO + "_div" + extensão.
 *
 * Ex.: FRS210002541525_div.jpg
 * Para Presidente: FBR{SQ_CANDIDATO}_div.jpg
 */
function findPhotoFile(id, uf, office = '') {
  const safeId = String(id || '').trim();
  const safeUf = getEffectiveUf(office, uf || 'RS');

  if (!isSafeId(safeId) || !/^[A-Z]{2}$/.test(safeUf)) {
    return null;
  }

  const filenameBase = `F${safeUf}${safeId}_div`;

  for (const root of PHOTO_ROOTS) {
    for (const extension of EXTENSIONS) {
      const file = path.join(root, `${filenameBase}.${extension}`);

      if (fs.existsSync(file)) {
        return file;
      }
    }
  }

  return null;
}

function contentType(file) {
  switch (path.extname(file).toLowerCase()) {
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.jpeg':
    case '.jpg':
    default:
      return 'image/jpeg';
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).send('Método não permitido.');
  }

  const params = query(req);
  const id = String(params.id == null ? '' : params.id).trim();
  const office = normalize(params.office || '');
  const uf = getEffectiveUf(office, params.uf || 'RS');

  if (!id || !isSafeId(id)) {
    return res.status(400).send('ID de candidato inválido.');
  }

  if (!/^[A-Z]{2}$/.test(uf)) {
    return res.status(400).send('UF inválida.');
  }

  const file = findPhotoFile(id, uf, office);

  if (!file) {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=86400');
    return res.status(404).send('Foto local não encontrada.');
  }

  try {
    res.setHeader('Content-Type', contentType(file));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, immutable');
    return res.status(200).send(fs.readFileSync(file));
  } catch (error) {
    console.error('[LOCAL FOTO] erro:', error);
    return res.status(500).send('Não foi possível carregar a foto local.');
  }
};
