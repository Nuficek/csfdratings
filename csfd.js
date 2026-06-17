'use strict';

const { csfd } = require('node-csfd-api');
const { TTLCache, createLimiter } = require('./cache');
const { TTL_MAPPING, TTL_RATING, CSFD_CONCURRENCY } = require('./config');

const mappingCache = new TTLCache(20000); // imdbId -> {csfdId,url} (or null = no match)
const ratingCache = new TTLCache(20000);  // csfdId -> {rating,url}
const limit = createLimiter(CSFD_CONCURRENCY);

// --- title helpers -------------------------------------------------------

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
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

// CSFD film types that count as a movie vs a series.
const MOVIE_TYPES = new Set(['film', 'tv-film', 'theatrical', 'student-film', 'amateur-film', 'video-compilation']);
const SERIES_TYPES = new Set(['series', 'tv-show', 'season']);

/** Choose the best ČSFD search result for a given title/year/stremioType. */
function pickBest(search, stremioType, title, year) {
  const wanted = norm(title);
  const pool = []
    .concat(search.movies || [])
    .concat(search.tvSeries || []);

  let best = null;
  let bestScore = -Infinity;
  for (const c of pool) {
    const typeOk =
      stremioType === 'series'
        ? SERIES_TYPES.has(c.type)
        : MOVIE_TYPES.has(c.type);
    let score = titleScore(norm(c.title), wanted);
    // year proximity is a strong disambiguator
    if (year && c.year) {
      const d = Math.abs(c.year - year);
      score += d === 0 ? 0.5 : d === 1 ? 0.25 : d <= 3 ? 0 : -0.6;
    }
    score += typeOk ? 0.35 : -0.35;
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  // require a reasonable match to avoid wildly wrong ratings
  if (best && bestScore >= 0.6) return best;
  return null;
}

// --- public API ----------------------------------------------------------

/**
 * Resolve a ČSFD numeric rating (0-100) for an IMDb item.
 * @returns {Promise<{rating:number|null, url:string|null}>}
 */
async function getRating(stremioType, imdbId, title, year) {
  // 1) imdb -> csfd id (cached, basically permanent)
  let mapping = mappingCache.get(imdbId);
  if (mapping === undefined) {
    mapping = await limit(async () => {
      // re-check inside the limiter in case another caller resolved it
      const again = mappingCache.get(imdbId);
      if (again !== undefined) return again;
      try {
        const search = await csfd.search(title);
        const best = pickBest(search, stremioType, title, year);
        const m = best ? { csfdId: best.id, url: best.url } : null;
        mappingCache.set(imdbId, m, TTL_MAPPING);
        return m;
      } catch (e) {
        // transient failure: cache the miss briefly so we retry later
        mappingCache.set(imdbId, null, 1000 * 60 * 10);
        return null;
      }
    });
  }
  if (!mapping) return { rating: null, url: null };

  // 2) csfd id -> numeric rating (cached, medium TTL)
  let rated = ratingCache.get(mapping.csfdId);
  if (rated === undefined) {
    rated = await limit(async () => {
      const again = ratingCache.get(mapping.csfdId);
      if (again !== undefined) return again;
      try {
        const movie = await csfd.movie(mapping.csfdId);
        const r = typeof movie.rating === 'number' ? movie.rating : null;
        const val = { rating: r, url: movie.url || mapping.url };
        ratingCache.set(mapping.csfdId, val, TTL_RATING);
        return val;
      } catch (e) {
        ratingCache.set(mapping.csfdId, { rating: null, url: mapping.url }, 1000 * 60 * 10);
        return { rating: null, url: mapping.url };
      }
    });
  }
  return rated;
}

module.exports = { getRating, _norm: norm, _pickBest: pickBest };
