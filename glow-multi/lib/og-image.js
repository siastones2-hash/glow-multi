'use strict';
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');

let createCanvas = null;
let GlobalFonts = null;
let canvasReady = false;
let fontRegistered = false;

function tryLoadCanvas() {
  if (canvasReady) return true;
  try {
    const c = require('@napi-rs/canvas');
    createCanvas = c.createCanvas;
    GlobalFonts = c.GlobalFonts;
    canvasReady = true;
    return true;
  } catch (e) {
    console.log('OG canvas unavailable:', e.message);
    return false;
  }
}

function registerFont() {
  if (fontRegistered || !GlobalFonts) return;
  const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'NanumGothic-Bold.ttf');
  if (fs.existsSync(fontPath)) {
    try {
      GlobalFonts.registerFromPath(fontPath, 'OgSans');
      fontRegistered = true;
    } catch (e) {
      console.log('OG font register fail:', e.message);
    }
  }
}

function parseHexColor(hex, fallback) {
  const h = String(hex || '').replace('#', '');
  if (/^[0-9a-fA-F]{6}$/.test(h)) {
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  return fallback;
}

function buildOgShareSvg(site) {
  const name = String(site?.name || 'GLOW').slice(0, 28);
  const logo = String(site?.logo || '✨').slice(0, 8);
  const slogan = String(site?.slogan || '콘텐츠가 빛나도록').slice(0, 36);
  const sub = String(site?.slogan_sub || '우리가 성장시킵니다').slice(0, 40);
  const p1 = String(site?.primary_color || '#7209B7').replace(/[^#A-Fa-f0-9]/g, '') || '#7209B7';
  const p2 = String(site?.accent_color || '#F72585').replace(/[^#A-Fa-f0-9]/g, '') || '#F72585';
  const esc = (s) => String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${esc(p1)}"/>
      <stop offset="55%" stop-color="${esc(p2)}"/>
      <stop offset="100%" stop-color="#1A1030"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="600" cy="210" r="70" fill="rgba(255,255,255,0.18)"/>
  <text x="600" y="240" text-anchor="middle" font-size="72">${esc(logo)}</text>
  <text x="600" y="360" text-anchor="middle" fill="#FFFFFF" font-family="sans-serif" font-size="64" font-weight="800">${esc(name)}</text>
  <text x="600" y="430" text-anchor="middle" fill="#F3E8FF" font-family="sans-serif" font-size="28">${esc(slogan)}</text>
  <text x="600" y="480" text-anchor="middle" fill="#E9D5FF" font-family="sans-serif" font-size="22">${esc(sub)}</text>
</svg>`;
}

/** 의존성 없이 그라데이션만 (fallback) */
function buildOgSharePngGradient(site) {
  const W = 1200, H = 630;
  const c1 = parseHexColor(site?.primary_color, [114, 9, 183]);
  const c2 = parseHexColor(site?.accent_color, [247, 37, 133]);
  const rows = [];
  for (let y = 0; y < H; y++) {
    const row = Buffer.alloc(1 + W * 3);
    row[0] = 0;
    const ty = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const tx = x / (W - 1);
      const t = (tx * 0.65 + ty * 0.35);
      const r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
      const g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
      const b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
      const i = 1 + x * 3;
      row[i] = r; row[i + 1] = g; row[i + 2] = b;
    }
    rows.push(row);
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const crcTable = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    return table;
  })();
  const crc32 = (buf) => {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type);
    const crcBuf = Buffer.alloc(4);
    crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crcBuf]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/** 카카오톡용 PNG — 로고·사이트명·슬로건 포함 */
function buildOgSharePng(site) {
  if (!tryLoadCanvas()) return buildOgSharePngGradient(site);
  registerFont();
  const W = 1200, H = 630;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  const p1 = String(site?.primary_color || '#7209B7');
  const p2 = String(site?.accent_color || '#F72585');
  const name = String(site?.name || 'GLOW').slice(0, 24);
  const logo = String(site?.logo || '✨').slice(0, 4);
  const slogan = String(site?.slogan || '콘텐츠가 빛나도록').slice(0, 32);
  const sub = String(site?.slogan_sub || '소셜 성장 · 마케팅 플랫폼').slice(0, 36);
  const domain = String(site?.domain || '').replace(/^www\./, '').slice(0, 40);

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, p1);
  grad.addColorStop(0.55, p2);
  grad.addColorStop(1, '#1A1030');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  const glow = ctx.createRadialGradient(600, 240, 40, 600, 240, 380);
  glow.addColorStop(0, 'rgba(255,255,255,0.28)');
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // logo circle
  ctx.beginPath();
  ctx.arc(600, 200, 78, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.16)';
  ctx.fill();

  const fontFamily = fontRegistered ? 'OgSans' : 'sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';
  ctx.font = `72px ${fontFamily}`;
  ctx.fillText(logo, 600, 205);

  ctx.font = `bold 62px ${fontFamily}`;
  ctx.fillText(name, 600, 340);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.font = `28px ${fontFamily}`;
  ctx.fillText(slogan, 600, 415);

  ctx.fillStyle = 'rgba(255,255,255,0.72)';
  ctx.font = `22px ${fontFamily}`;
  ctx.fillText(sub, 600, 460);

  if (domain) {
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = `18px ${fontFamily}`;
    ctx.fillText(domain, 600, 560);
  }

  // bottom accent bar
  const bar = ctx.createLinearGradient(360, 0, 840, 0);
  bar.addColorStop(0, 'rgba(255,255,255,0)');
  bar.addColorStop(0.5, 'rgba(255,255,255,0.7)');
  bar.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bar;
  ctx.fillRect(360, 505, 480, 3);

  return canvas.toBuffer('image/png');
}

module.exports = { buildOgShareSvg, buildOgSharePng };
