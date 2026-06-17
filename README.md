# ČSFD Ratings — Stremio addon

A Stremio addon that overlays **ČSFD** ([csfd.cz](https://www.csfd.cz)) ratings onto
movie and series posters — the same idea as RPDB / "TOP posters", but the rating
comes from ČSFD instead of IMDb/TMDB.

It mirrors the official **Cinemeta** "Popular" catalogs and, for every poster,
renders the ČSFD percentage rating as a coloured badge:

| ČSFD score | Badge colour | Meaning (ČSFD convention) |
|-----------|--------------|---------------------------|
| 70–100 %  | red          | good                      |
| 30–69 %   | blue         | average                   |
| 0–29 %    | dark grey    | bad                       |

On a title's detail page it also adds the ČSFD rating to the description and a
link straight to the ČSFD page.

---

## How it works

```
Stremio  ──catalog──▶  addon  ──▶  Cinemeta (titles, original posters)
                         │
                         └─ rewrites every poster URL to  /poster/:type/:id.jpg
                                                              │
Stremio ──requests poster──▶  /poster endpoint ──▶ Cinemeta (title + year)
                                                 └─▶ ČSFD search + rating
                                                 └─▶ sharp composites the badge
```

The catalog response is instant because it only rewrites poster URLs. The ČSFD
lookup and image compositing happen lazily, per poster, when Stremio actually
requests the image — and everything is cached. This is the same lazy approach
the RPDB poster addons use.

**Matching IMDb → ČSFD.** The `node-csfd-api` library has no IMDb-ID field, so
titles are matched by **name + year + type** against ČSFD search results
(diacritics-insensitive, with year as the main disambiguator). This is
best-effort: it is accurate for the vast majority of mainstream titles but can
occasionally mismatch obscure entries that share a name and year. Misses fall
back to the plain original poster.

---

## Run locally

Requires Node.js 18+ (uses the built-in `fetch`).

```bash
npm install
npm start
```

Open `http://127.0.0.1:7000` and click **Install in Stremio**, or paste
`http://127.0.0.1:7000/manifest.json` into Stremio → *Addons → Add addon*.

> Local install works on the same machine. To use it on a phone / TV / another
> device, host it (below) and set `BASE_URL`.

### Configuration (env vars)

| Variable           | Default                   | Purpose                                              |
|--------------------|---------------------------|------------------------------------------------------|
| `PORT`             | `7000`                    | Listen port                                          |
| `BASE_URL`         | `http://127.0.0.1:$PORT`  | **Public** URL — poster links are built from this. Must be the externally reachable address when hosted. |
| `POSTER_WIDTH`     | `500`                     | Rendered poster width (px)                           |
| `CSFD_CONCURRENCY` | `3`                       | Max simultaneous ČSFD lookups (be polite to csfd.cz) |

---

## Deploy on Render

It runs on Render's free tier as a normal Node web service. **No `BASE_URL`
needed** — the app reads Render's `RENDER_EXTERNAL_URL` automatically.

**Option A — Blueprint (one click).** Push this folder to a GitHub/GitLab repo,
then in Render: **New + → Blueprint → pick the repo**. The included
[`render.yaml`](render.yaml) sets everything up.

**Option B — Manual.** In Render: **New + → Web Service → connect the repo**, then:

| Field           | Value           |
|-----------------|-----------------|
| Runtime         | Node            |
| Build command   | `npm install`   |
| Start command   | `npm start`     |
| Instance type   | Free is fine    |

Leave env vars empty (or set `CSFD_CONCURRENCY=2`). After it deploys, install in
Stremio using `https://<your-app>.onrender.com/manifest.json`.

**Two things to know about Render:**

- **Free tier sleeps** after ~15 min idle and cold-starts in ~30–60 s, so the
  first catalog/poster after a nap is slow. The in-memory cache also resets on
  each restart. Fine for personal use; pick a paid instance if you want it warm.
- **Datacenter IP.** csfd.cz is scraped, and sites sometimes rate-limit or block
  shared cloud IPs. If posters stop showing ČSFD ratings (you get plain posters
  or errors in the logs), keep `CSFD_CONCURRENCY` low (1–2), or host it on a home
  server / small VPS instead. There is no way around this other than fewer/slower
  requests, since ČSFD has no official API.

### Other hosts / Docker

When hosted anywhere else, set `BASE_URL` to the public HTTPS URL:

```bash
BASE_URL=https://csfd.example.com PORT=7000 npm start
```

```bash
docker build -t csfd-stremio .
docker run -p 7000:7000 -e BASE_URL=https://csfd.example.com csfd-stremio
```

Put it behind HTTPS (Caddy / Nginx / Cloudflare Tunnel). Railway, Fly.io, or a
small VPS all work the same way.

---

## Extending the catalogs

Right now it mirrors Cinemeta's "Popular" (`top`) catalog for movies and series.
To add more, edit `CATALOG_MAP` and the `catalogs` array in
[`src/addon.js`](src/addon.js):

```js
const CATALOG_MAP = {
  'csfd.top': 'top',
  // 'csfd.newyear': 'year',   // map your catalog id -> a Cinemeta catalog id
};
```

The `genre`, `skip`, and `search` extras are forwarded to Cinemeta, so paging,
genre filtering, and search work out of the box.

---

## Limitations & notes

- **Unofficial data.** ČSFD has no public API; ratings are scraped via
  `node-csfd-api`. If ČSFD changes its HTML or rate-limits you, lookups may fail
  (the addon then shows the plain poster). Keep `CSFD_CONCURRENCY` low.
- **Matching** is name+year based (see above) — not 100 % for obscure titles.
- Caching is in-memory, so it resets on restart. Ratings cache for ~12 h,
  IMDb→ČSFD mappings for ~30 days, rendered posters for ~24 h.
- Personal/educational use. Respect ČSFD's terms of service.

## Project layout

```
src/
  config.js    env config + cache TTLs
  cache.js     TTL cache + concurrency limiter
  cinemeta.js  Cinemeta catalog/meta client
  csfd.js      IMDb(title/year) -> ČSFD id -> numeric rating, cached
  poster.js    sharp: composite the rating badge onto the poster
  addon.js     manifest + catalog/meta handlers
  server.js    Express: addon router + /poster endpoint + landing page
```
