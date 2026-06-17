'use strict';

const { csfd } = require('node-csfd-api');
const { TTLCache, createLimiter } = require('./cache');
const { TTL_MAPPING, TTL_RATING, CSFD_CONCURRENCY } = require('./config');

// Use the English ČSFD interface so search returns English titles (far better
// matching against Cinemeta's English names), and send a browser-like UA to
// reduce blocking from shared/datacenter IPs.
csfd.setOptions({
  language: 'en',
  request: {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      'Accept-Language': 'en-US,en;q=0.9,cs;q=0.8',
    },
  },
});

const mappingCache = new TTLCache(20000); // imdbId -> {csfdId,url} | null
const ratingCache = new TTLCache(20000);  // csfdId -> {rating,url}
const limit = createLimiter(CSFD_CONCURRENCY);

const SHORT_FAIL = 2 * 60 * 1000; // transient errors: retry soon

// --- title helpers -------------------------------------------------------

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokenJaccard(a, b) {
  const A = new Set(a.split(' ').filter(Boolean));
  const B = new Set(b.split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

function titleScore(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8;
  return tokenJaccard(a, b);
}

const MOVIE_TYPES = new Set(['film', 'tv-film', 'theatrical', 'student-film', 'amateur-film', 'video-compilation']);
const SERIES_TYPES = new Set(['series', 'tv-show', 'season']);

function pickBest(search, stremioType, title, year) {
  const wanted = norm(title);
  const pool = [].concat(search.movies || []).concat(search.tvSeries || []);
  let best = null;
  let bestScore = -Infinity;
  for (const c of pool) {
    const typeOk = stremioType === 'series' ? SERIES_TYPES.has(c.type) : MOVIE_TYPES.has(c.type);
    let score = titleScore(norm(c.title), wanted);
    if (year && c.year) {
      const d = Math.abs(c.year - year);
      score += d === 0 ? 0.5 : d === 1 ? 0.25 : d <= 3 ? 0 : -0.6;
    }
    score += typeOk ? 0.35 : -0.35;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  return best && bestScore >= 0.6 ? best : null;
}

// retry a flaky scrape once after a short delay
async function withRetry(fn) {
  try {
    return await fn();
  } catch (e) {
    await new Promise((r) => setTimeout(r, 700));
    return fn();
  }
}

// --- public API ----------------------------------------------------------

async function getRating(stremioType, imdbId, title, year) {
  let mapping = mappingCache.get(imdbId);
  if (mapping === undefined) {
    mapping = await limit(async () => {
      const again = mappingCache.get(imdbId);
      if (again !== undefined) return again;
      try {
        const search = await withRetry(() => csfd.search(title));
        const best = pickBest(search, stremioType, title, year);
        if (!best) {
          const n = (search.movies || []).length + (search.tvSeries || []).length;
          console.log(`[csfd] no match: "${title}" (${year || '?'}) ${imdbId} — ${n} result(s) but none matched`);
        }
        const m = best ? { csfdId: best.id, url: best.url } : null;
        mappingCache.set(imdbId, m, m ? TTL_MAPPING : TTL_RATING);
        return m;
      } catch (e) {
        console.warn(`[csfd] search error for "${title}" ${imdbId}: ${e.message}`);
        mappingCache.set(imdbId, null, SHORT_FAIL); // transient: retry later
        return null;
      }
    });
  }
  if (!mapping) return { rating: null, url: null };

  let rated = ratingCache.get(mapping.csfdId);
  if (rated === undefined) {
    rated = await limit(async () => {
      const again = ratingCache.get(mapping.csfdId);
      if (again !== undefined) return again;
      try {
        const movie = await withRetry(() => csfd.movie(mapping.csfdId));
        const r = typeof movie.rating === 'number' ? movie.rating : null;
        if (r === null) console.log(`[csfd] no numeric rating yet on csfd #${mapping.csfdId} ("${title}")`);
        const val = { rating: r, url: movie.url || mapping.url };
        ratingCache.set(mapping.csfdId, val, TTL_RATING);
        return val;
      } catch (e) {
        console.warn(`[csfd] movie error csfd #${mapping.csfdId} ("${title}"): ${e.message}`);
        ratingCache.set(mapping.csfdId, { rating: null, url: mapping.url }, SHORT_FAIL);
        return { rating: null, url: mapping.url };
      }
    });
  }
  return rated;
}

module.exports = { getRating, _norm: norm, _pickBest: pickBest };
