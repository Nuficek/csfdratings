'use strict';

const sharp = require('sharp');

/**
 * ČSFD-style colour coding:
 *   good    (>= 70%) -> red    (ČSFD's signature "red" rating)
 *   average (30-69%) -> blue
 *   bad     (< 30%)  -> dark grey/black
 */
function ratingColor(rating) {
  if (rating >= 70) return '#b81e1e';
  if (rating >= 30) return '#1f5f99';
  return '#3a3a3a';
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

/**
 * Build an SVG overlay (same dimensions as the poster) with a rounded
 * rating pill in the top-left corner, plus a small "ČSFD" label.
 */
function buildBadgeSvg(width, height, rating) {
  // Scale the badge to the poster width so it looks right at any resolution.
  const pad = Math.round(width * 0.04);
  const fontSize = Math.round(width * 0.16);
  const labelSize = Math.round(width * 0.052);
  const pillH = Math.round(fontSize * 1.18);
  const text = `${Math.round(rating)}%`;
  // Rough width estimate for the pill (digits are ~0.62em wide here).
  const textW = text.length * fontSize * 0.6;
  const pillW = Math.round(textW + pad * 1.6);
  const x = pad;
  const y = pad;
  const color = ratingColor(rating);
  const textY = y + pillH * 0.5;

  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"
     xmlns="http://www.w3.org/2000/svg">
  <defs>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="${Math.max(1, Math.round(width*0.006))}"
                    stdDeviation="${Math.max(1, Math.round(width*0.006))}"
                    flood-color="#000" flood-opacity="0.55"/>
    </filter>
  </defs>
  <g filter="url(#sh)" font-family="DejaVu Sans, Arial, Helvetica, sans-serif">
    <rect x="${x}" y="${y}" rx="${Math.round(pillH*0.22)}" ry="${Math.round(pillH*0.22)}"
          width="${pillW}" height="${pillH}" fill="${color}" fill-opacity="0.95"/>
    <text x="${x + pillW/2}" y="${textY}" fill="#ffffff"
          font-size="${fontSize}" font-weight="700"
          text-anchor="middle" dominant-baseline="central">${escapeXml(text)}</text>
    <text x="${x + pad*0.4}" y="${y + pillH + labelSize*1.15}" fill="#ffffff"
          font-size="${labelSize}" font-weight="700" letter-spacing="1"
          stroke="#000" stroke-width="${Math.max(1,Math.round(width*0.0035))}"
          paint-order="stroke">ČSFD</text>
  </g>
</svg>`);
}

/**
 * Fetch the original poster, composite the rating badge, return a JPEG buffer.
 * @param {string} originalUrl  URL of the original poster (from Cinemeta).
 * @param {number} rating       ČSFD rating 0-100, or null for "no rating".
 * @param {number} targetWidth  Resize width (keeps aspect ratio). Default 500.
 */
async function buildPoster(originalUrl, rating, targetWidth = 500) {
  const res = await fetch(originalUrl, {
    headers: { 'User-Agent': 'Mozilla/5.0 (csfd-stremio-addon)' },
  });
  if (!res.ok) throw new Error(`poster fetch ${res.status}`);
  const input = Buffer.from(await res.arrayBuffer());

  let img = sharp(input).resize({ width: targetWidth, withoutEnlargement: false });
  const meta = await img.metadata();
  const w = meta.width || targetWidth;
  const h = meta.height || Math.round(targetWidth * 1.5);

  // If we have no rating, just return the (resized) original poster untouched.
  if (rating === null || rating === undefined || Number.isNaN(rating)) {
    return img.jpeg({ quality: 88 }).toBuffer();
  }

  const svg = buildBadgeSvg(w, h, rating);
  return img
    .composite([{ input: svg, top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
}

module.exports = { buildPoster, buildBadgeSvg, ratingColor };
