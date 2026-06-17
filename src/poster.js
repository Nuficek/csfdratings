'use strict';

const sharp = require('sharp');

const CSFD_RED = '#cc0a12';
const LOGO_URL =
  'https://img.csfd.cz/documents/marketing/logos/icon-red-transparent/icon-red-transparent.svg';

// --- logo (fetched once, rasterised to a transparent PNG, cached) -----------
let logoCache;            // {png:Buffer, aspect:number} on success, null after a failed try
let logoTriedAt = 0;

async function getLogo() {
  if (logoCache) return logoCache;
  if (logoCache === null && Date.now() - logoTriedAt < 10 * 60 * 1000) return null;
  logoTriedAt = Date.now();
  try {
    const res = await fetch(LOGO_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (csfd-stremio-addon)' },
    });
    if (!res.ok) throw new Error(`logo ${res.status}`);
    const svg = Buffer.from(await res.arrayBuffer());
    const png = await sharp(svg, { density: 384 })
      .resize({ height: 256 })
      .png()
      .toBuffer();
    const meta = await sharp(png).metadata();
    logoCache = { png, aspect: (meta.width || 256) / (meta.height || 256) };
    return logoCache;
  } catch (e) {
    console.warn('[poster] logo fetch failed, badge will be text-only:', e.message);
    logoCache = null;
    return null;
  }
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

/**
 * A rounded pill, centred along the bottom of the poster:
 *   [ CSFD logo ]  84%
 * Dark translucent fill, thin red border, white rating text.
 */
function buildBadgeSvg(W, H, rating, logo) {
  const ph = Math.max(28, Math.round(W * 0.135));      // pill height
  const fontSize = Math.round(ph * 0.6);
  const ipad = Math.round(ph * 0.34);                  // inner horizontal padding
  const gap = Math.round(ph * 0.22);                   // logo<->text gap
  const border = Math.max(2, Math.round(W * 0.009));
  const logoH = Math.round(ph * 0.64);
  const logoW = logo ? Math.round(logoH * logo.aspect) : 0;

  const text = `${Math.round(rating)}%`;
  const textW = Math.round(text.length * fontSize * 0.6);
  const contentW = (logo ? logoW + gap : 0) + textW;
  const pw = contentW + ipad * 2;
  const px = Math.round((W - pw) / 2);
  const margin = Math.round(W * 0.04);
  const py = H - ph - margin;
  const cy = py + ph / 2;
  const rx = Math.round(ph * 0.34);

  const logoX = px + ipad;
  const logoY = Math.round(cy - logoH / 2);
  const textX = px + ipad + (logo ? logoW + gap : 0);

  const logoEl = logo
    ? `<image x="${logoX}" y="${logoY}" width="${logoW}" height="${logoH}"
              preserveAspectRatio="xMidYMid meet"
              xlink:href="data:image/png;base64,${logo.png.toString('base64')}"/>`
    : '';

  const shadow = Math.max(1, Math.round(W * 0.006));
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
     xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <defs>
    <filter id="sh" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="${Math.max(1, Math.round(W*0.004))}"
                    stdDeviation="${shadow}" flood-color="#000" flood-opacity="0.6"/>
    </filter>
  </defs>
  <g filter="url(#sh)" font-family="DejaVu Sans, Arial, Helvetica, sans-serif">
    <rect x="${px}" y="${py}" width="${pw}" height="${ph}" rx="${rx}" ry="${rx}"
          fill="#141414" fill-opacity="0.88"
          stroke="${CSFD_RED}" stroke-width="${border}"/>
    ${logoEl}
    <text x="${textX}" y="${cy}" fill="#ffffff" font-size="${fontSize}"
          font-weight="700" text-anchor="start" dominant-baseline="central">${escapeXml(text)}</text>
  </g>
</svg>`);
}

/**
 * Fetch the original poster, composite the CSFD rating pill, return a JPEG.
 * Resizes to a buffer FIRST, then reads the real dimensions, so the overlay
 * always matches the base canvas (this is what was breaking before).
 */
async function buildPoster(originalUrl, rating, targetWidth = 600) {
  const res = await fetch(originalUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (csfd-stremio-addon)' },
  });
  if (!res.ok) throw new Error(`poster fetch ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  // 1) resize to a concrete buffer, then 2) read ITS dimensions
  const resized = await sharp(input)
    .resize({ width: targetWidth, withoutEnlargement: false })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const w = meta.width || targetWidth;
  const h = meta.height || Math.round(targetWidth * 1.5);

  if (rating === null || rating === undefined || Number.isNaN(rating)) {
    return sharp(resized).jpeg({ quality: 88 }).toBuffer();
  }

  const logo = await getLogo();
  const svg = buildBadgeSvg(w, h, rating, logo);
  return sharp(resized)
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { buildPoster, buildBadgeSvg, getLogo };
