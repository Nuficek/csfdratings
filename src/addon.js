'use strict';

const { addonBuilder } = require('stremio-addon-sdk');
const { BASE_URL } = require('./config');
const cinemeta = require('./cinemeta');
const { getRating } = require('./csfd');

const pkg = require('./package.json');

// Which Cinemeta catalog each of our catalogs mirrors.
// Add more rows here to expose additional ČSFD-rated catalogs.
const CATALOG_MAP = {
  'csfd.top': 'top', // Cinemeta "Popular"
};

const sharedExtra = [
  { name: 'genre', isRequired: false },
  { name: 'skip', isRequired: false },
  { name: 'search', isRequired: false },
];

const manifest = {
  id: 'community.csfd.ratings.posters',
  version: pkg.version,
  name: 'ČSFD Ratings',
  description:
    'Adds ČSFD (csfd.cz) ratings onto movie and series posters, in the style of rating-poster addons. ' +
    'Mirrors Cinemeta catalogs and overlays the ČSFD percentage rating on each poster.',
  logo: 'https://www.csfd.cz/favicon.ico',
  resources: ['catalog', 'meta'],
  types: ['movie', 'series'],
  idPrefixes: ['tt'],
  catalogs: [
    { type: 'movie', id: 'csfd.top', name: 'ČSFD Popular', extra: sharedExtra },
    { type: 'series', id: 'csfd.top', name: 'ČSFD Popular', extra: sharedExtra },
  ],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const builder = new addonBuilder(manifest);

function posterUrl(type, id) {
  return `${BASE_URL}/poster/${type}/${encodeURIComponent(id)}.jpg`;
}

// --- Catalog ----------------------------------------------------------------
// Fast: we only rewrite poster URLs to point at our renderer. The actual ČSFD
// lookup + composite happens lazily when Stremio requests each poster image.
builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const cinemetaId = CATALOG_MAP[id];
  if (!cinemetaId) return { metas: [] };

  const { metas } = await cinemeta.getCatalog(type, cinemetaId, extra);
  const out = metas.map((m) => ({
    ...m,
    poster: m.id && m.id.startsWith('tt') ? posterUrl(type, m.id) : m.poster,
    posterShape: 'poster',
  }));
  return { metas: out };
});

// --- Meta -------------------------------------------------------------------
// On the detail page we can afford one ČSFD lookup: rewrite the poster and add
// the rating + a link to the ČSFD page into the description.
builder.defineMetaHandler(async ({ type, id }) => {
  const meta = await cinemeta.getMeta(type, id);
  if (!meta) return { meta: null };

  const year = cinemeta.parseYear(meta.year || meta.releaseInfo);
  let rating = null;
  let url = null;
  try {
    const r = await getRating(type, id, meta.name, year);
    rating = r.rating;
    url = r.url;
  } catch (_) { /* fall back to plain meta */ }

  const enriched = {
    ...meta,
    poster: posterUrl(type, id),
  };

  if (rating !== null && rating !== undefined) {
    const line = `★ ČSFD: ${Math.round(rating)} %`;
    enriched.description = `${line}\n\n${meta.description || ''}`.trim();
    enriched.links = [
      ...(meta.links || []),
      ...(url ? [{ name: `ČSFD ${Math.round(rating)} %`, category: 'ČSFD', url }] : []),
    ];
  }
  return { meta: enriched };
});

module.exports = builder.getInterface();
module.exports.manifest = manifest;
