'use strict';

const { CINEMETA, TTL_CATALOG, TTL_META } = require('./config');
const { TTLCache } = require('./cache');

const catalogCache = new TTLCache(500);
const metaCache = new TTLCache(8000);

// Lightweight info we keep so the poster endpoint can resolve title/year/poster
// for any id we've seen, without re-hitting Cinemeta. id -> {type,title,year,poster}
const infoCache = new TTLCache(20000);

function rememberInfo(type, m) {
  if (!m || !m.id) return;
  infoCache.set(m.id, {
    type,
    title: m.name || m.title,
    year: parseYear(m.year || m.releaseInfo),
    poster: m.poster,
  }, TTL_META);
}

function parseYear(v) {
  if (!v) return null;
  const match = String(v).match(/\d{4}/);
  return match ? parseInt(match[0], 10) : null;
}

function buildExtraSuffix(extra) {
  if (!extra) return '';
  const parts = [];
  for (const key of ['genre', 'search', 'skip']) {
    if (extra[key] !== undefined && extra[key] !== null && extra[key] !== '') {
      parts.push(`${key}=${encodeURIComponent(extra[key])}`);
    }
  }
  return parts.length ? '/' + parts.join('&') : '';
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'csfd-stremio-addon' },
  });
  if (!res.ok) throw new Error(`cinemeta ${res.status} ${url}`);
  return res.json();
}

/** Fetch a Cinemeta catalog (e.g. type=movie, id=top). Returns {metas:[...]}. */
async function getCatalog(type, cinemetaId, extra) {
  const suffix = buildExtraSuffix(extra);
  const url = `${CINEMETA}/catalog/${type}/${cinemetaId}${suffix}.json`;
  const cached = catalogCache.get(url);
  if (cached) return cached;
  const data = await getJson(url);
  const metas = Array.isArray(data.metas) ? data.metas : [];
  for (const m of metas) rememberInfo(type, m);
  const result = { metas };
  catalogCache.set(url, result, TTL_CATALOG);
  return result;
}

/** Fetch a single Cinemeta meta. Returns the meta object or null. */
async function getMeta(type, id) {
  const key = `${type}:${id}`;
  const cached = metaCache.get(key);
  if (cached !== undefined) return cached;
  let meta = null;
  try {
    const data = await getJson(`${CINEMETA}/meta/${type}/${id}.json`);
    meta = data && data.meta ? data.meta : null;
  } catch (_) {
    meta = null;
  }
  if (meta) rememberInfo(type, meta);
  metaCache.set(key, meta, TTL_META);
  return meta;
}

/** Best-effort title/year/poster for an id (from cache, else Cinemeta). */
async function getInfo(type, id) {
  const cached = infoCache.get(id);
  if (cached) return cached;
  const meta = await getMeta(type, id);
  if (!meta) return null;
  return infoCache.get(id) || {
    type,
    title: meta.name,
    year: parseYear(meta.year || meta.releaseInfo),
    poster: meta.poster,
  };
}

module.exports = { getCatalog, getMeta, getInfo, parseYear };
