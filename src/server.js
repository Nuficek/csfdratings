'use strict';

const express = require('express');
const { getRouter } = require('stremio-addon-sdk');

const { PORT, BASE_URL, POSTER_WIDTH, TTL_POSTER } = require('./config');
const addonInterface = require('./addon');
const cinemeta = require('./cinemeta');
const { getRating } = require('./csfd');
const { buildPoster } = require('./poster');
const { TTLCache } = require('./cache');

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  next();
});

const posterCache = new TTLCache(4000); // key -> {buf, ct}

// /poster/:type/:id.jpg  -> original poster with ČSFD rating badge composited
app.get('/poster/:type/:file', async (req, res) => {
  const { type } = req.params;
  const id = req.params.file.replace(/\.(jpg|jpeg|png)$/i, '');
  const cacheKey = `${type}:${id}`;

  try {
    const cached = posterCache.get(cacheKey);
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.setHeader('Content-Type', cached.ct);
      return res.end(cached.buf);
    }

    const info = await cinemeta.getInfo(type, id);
    if (!info || !info.poster) return res.status(404).end('no source poster');

    let rating = null;
    try {
      const r = await getRating(type, id, info.title, info.year);
      rating = r.rating;
    } catch (_) { /* render plain poster on lookup failure */ }

    const buf = await buildPoster(info.poster, rating, POSTER_WIDTH);
    posterCache.set(cacheKey, { buf, ct: 'image/jpeg' }, TTL_POSTER);

    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Content-Type', 'image/jpeg');
    return res.end(buf);
  } catch (e) {
    // Last-resort: redirect to the original Cinemeta poster so Stremio still
    // shows *something* instead of a broken image.
    try {
      const info = await cinemeta.getInfo(type, id);
      if (info && info.poster) return res.redirect(302, info.poster);
    } catch (_) { /* ignore */ }
    return res.status(502).end('poster error');
  }
});

app.get('/', (_req, res) => {
  const install = `${BASE_URL}/manifest.json`;
  const deep = install.replace(/^https?:\/\//, 'stremio://');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.end(`<!doctype html><meta charset="utf-8">
<title>ČSFD Ratings — Stremio addon</title>
<style>body{font-family:system-ui,sans-serif;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5}
a.btn{display:inline-block;background:#b81e1e;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:700}
code{background:#f2f2f2;padding:2px 6px;border-radius:4px}</style>
<h1>ČSFD Ratings</h1>
<p>Adds <strong>ČSFD</strong> ratings onto movie &amp; series posters in Stremio.</p>
<p><a class="btn" href="${deep}">Install in Stremio</a></p>
<p>Or paste this URL into Stremio &rarr; Addons &rarr; <em>Add addon</em>:</p>
<p><code>${install}</code></p>`);
});

// Mount the Stremio addon (serves /manifest.json, /catalog/..., /meta/...).
app.use(getRouter(addonInterface));

app.listen(PORT, () => {
  console.log(`ČSFD Ratings addon running on ${BASE_URL}`);
  console.log(`Manifest:  ${BASE_URL}/manifest.json`);
});
