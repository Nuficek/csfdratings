'use strict';

const PORT = parseInt(process.env.PORT || '7000', 10);

// Public URL where this addon is reachable. Poster URLs handed to Stremio are
// built from this, so it MUST be the externally reachable address when hosted.
// On Render, RENDER_EXTERNAL_URL is set automatically (e.g. https://app.onrender.com),
// so deployment works with no manual BASE_URL.
const BASE_URL = (
  process.env.BASE_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  `http://127.0.0.1:${PORT}`
).replace(/\/+$/, '');

module.exports = {
  PORT,
  BASE_URL,
  CINEMETA: 'https://v3-cinemeta.strem.io',
  POSTER_WIDTH: parseInt(process.env.POSTER_WIDTH || '600', 10),

  // Cache lifetimes (ms)
  TTL_MAPPING: 1000 * 60 * 60 * 24 * 30, // imdb -> csfd id basically never changes
  TTL_RATING: 1000 * 60 * 60 * 12,       // ratings drift slowly
  TTL_CATALOG: 1000 * 60 * 30,           // catalog listings
  TTL_META: 1000 * 60 * 60 * 6,          // cinemeta meta
  TTL_POSTER: 1000 * 60 * 60 * 24,       // rendered poster bytes

  // Be polite to csfd.cz: cap how many lookups run at once.
  CSFD_CONCURRENCY: parseInt(process.env.CSFD_CONCURRENCY || '3', 10),
};
