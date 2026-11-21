// Flat X-SSH icon set, drawn from the original X geometry (option C: white front bar,
// green back bar, dark tile). Self-contained: parses the two bar paths, rasterizes them
// with anti-aliasing and writes the PNGs and the .ico.   run: node build/icon-src/flat/make.cjs
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const out = path.join(__dirname, '..', '..')

const BACK = 'M659.49,237.62 A63,63 0 0,1 703.71,219.5 L786.18,219.5 A63,63 0 0,1 830.39,327.38 L364.51,786.38 A63,63 0 0,1 320.29,804.5 L237.82,804.5 A63,63 0 0,1 193.61,696.62 Z'
const FRONT = 'M193.61,327.38 A63,63 0 0,1 237.82,219.5 L320.29,219.5 A63,63 0 0,1 364.51,237.62 L830.39,696.62 A63,63 0 0,1 786.18,804.5 L703.71,804.5 A63,63 0 0,1 659.49,786.38 Z'

// ---- path -> polygon (M, L, A with equal radii, Z; absolute coordinates) ----
function arc(p0, p1, r, sweep, pts) {
  // Two candidate centres lie r away from both ends; the right one makes the short
  // arc run in the sweep direction (sweep = 1: increasing angle, y pointing down).
  const mx = (p0[0] + p1[0]) / 2, my = (p0[1] + p1[1]) / 2
  const dx = p1[0] - p0[0], dy = p1[1] - p0[1]
  const d = Math.hypot(dx, dy), h = Math.sqrt(Math.max(0, r * r - (d * d) / 4))
  const ux = -dy / d, uy = dx / d
  const TAU = Math.PI * 2
  for (const sg of [1, -1]) {
    const cx = mx + sg * h * ux, cy = my + sg * h * uy
    const a0 = Math.atan2(p0[1] - cy, p0[0] - cx), a1 = Math.atan2(p1[1] - cy, p1[0] - cx)
    let da = ((a1 - a0) % TAU + TAU) % TAU // positive direction
    if (!sweep) da -= TAU
    if (Math.abs(da) < Math.PI) {
      const n = 24
      for (let i = 1; i <= n; i++) {
        const t = a0 + (da * i) / n
        pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)])
      }
      return
    }
  }
}
function parse(d) {
  const t = d.match(/[MLAZ]|-?[\d.]+/g)
  const pts = []
  let i = 0, cur = [0, 0]
  while (i < t.length) {
    const c = t[i++]
    if (c === 'M' || c === 'L') { cur = [+t[i], +t[i + 1]]; i += 2; pts.push(cur) }
    else if (c === 'A') { const r = +t[i]; const sweep = +t[i + 4]; const to = [+t[i + 5], +t[i + 6]]; i += 7; arc(cur, to, r, sweep, pts); cur = to }
  }
  return pts
}
function roundRect(x, y, w, h, r) {
  const pts = []
  const corners = [[x + w - r, y + r, -90], [x + w - r, y + h - r, 0], [x + r, y + h - r, 90], [x + r, y + r, 180]]
  for (const [cx, cy, a0] of corners) for (let i = 0; i <= 24; i++) { const a = ((a0 + (90 * i) / 24) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]) }
  return pts
}

// ---- rasterizer: coverage 0..1 per pixel (4 sub-scanlines, exact horizontal spans) ----
function coverage(poly, N, s, ox = 0, oy = 0) {
  const cov = new Float32Array(N * N)
  const SS = 4
  const P = poly.map(([x, y]) => [(x + ox) * s, (y + oy) * s])
  for (let row = 0; row < N; row++) {
    for (let sub = 0; sub < SS; sub++) {
      const y = row + (sub + 0.5) / SS
      const xs = []
      for (let i = 0; i < P.length; i++) {
        const a = P[i], b = P[(i + 1) % P.length]
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) xs.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]))
      }
      xs.sort((p, q) => p - q)
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.max(0, xs[k]), x1 = Math.min(N, xs[k + 1])
        if (x1 <= x0) continue
        for (let px = Math.floor(x0); px < Math.ceil(x1); px++) cov[row * N + px] += (Math.min(px + 1, x1) - Math.max(px, x0)) / SS
      }
    }
  }
  return cov
}
function paint(img, cov, [r, g, b], alpha = 1) {
  for (let i = 0; i < cov.length; i++) {
    const a = Math.min(1, cov[i]) * alpha
    if (!a) continue
    const o = i * 4, da = img[o + 3]
    const na = a + da * (1 - a)
    for (let c = 0; c < 3; c++) img[o + c] = ([r, g, b][c] * a + img[o + c] * da * (1 - a)) / na
    img[o + 3] = na
  }
}
function png(img, N) {
  const raw = Buffer.alloc(N * (N * 4 + 1))
  for (let y = 0; y < N; y++) {
    raw[y * (N * 4 + 1)] = 0
    for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 4, q = y * (N * 4 + 1) + 1 + x * 4
      raw[q] = Math.round(img[o]); raw[q + 1] = Math.round(img[o + 1]); raw[q + 2] = Math.round(img[o + 2]); raw[q + 3] = Math.round(img[o + 3] * 255)
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

const TILE = [10, 10, 10], GREEN = [35, 209, 139], WHITE = [242, 242, 242]
const back = parse(BACK), front = parse(FRONT)
const tile = roundRect(0, 0, 1024, 1024, 230), inset = roundRect(6, 6, 1012, 1012, 224)

function renderIcon(N) {
  const s = N / 1024
  const img = new Float32Array(N * N * 4)
  const tileCov = coverage(tile, N, s)
  paint(img, tileCov, TILE)
  const ring = coverage(inset, N, s)
  paint(img, tileCov.map((v, i) => Math.max(0, v - ring[i])), [255, 255, 255], 0.14)
  paint(img, coverage(back, N, s), GREEN)
  // The front bar is cut out of the back one by a hairline in the tile colour.
  const gap = new Float32Array(N * N)
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2, c = coverage(front, N, s, Math.cos(a) * 13, Math.sin(a) * 13)
    for (let i = 0; i < gap.length; i++) gap[i] = Math.max(gap[i], c[i])
  }
  paint(img, gap, TILE)
  paint(img, coverage(front, N, s), WHITE)
  return png(img, N)
}
function renderTray(N) {
  const s = N / 1024
  const img = new Float32Array(N * N * 4)
  paint(img, coverage(back, N, s), [0, 0, 0])
  paint(img, coverage(front, N, s), [0, 0, 0])
  return png(img, N)
}
function ico(entries) {
  const head = Buffer.alloc(6); head.writeUInt16LE(1, 2); head.writeUInt16LE(entries.length, 4)
  let off = 6 + entries.length * 16
  const dir = entries.map(({ size, buf }) => {
    const e = Buffer.alloc(16)
    e[0] = size >= 256 ? 0 : size; e[1] = size >= 256 ? 0 : size
    e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(buf.length, 8); e.writeUInt32LE(off, 12)
    off += buf.length
    return e
  })
  return Buffer.concat([head, ...dir, ...entries.map((p) => p.buf)])
}

fs.writeFileSync(path.join(out, 'icon.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" rx="230" fill="#0a0a0a"/>
  <rect x="3" y="3" width="1018" height="1018" rx="227" fill="none" stroke="#ffffff" stroke-opacity="0.14" stroke-width="6"/>
  <path d="${BACK}" fill="#23d18b"/>
  <path d="${FRONT}" fill="#f2f2f2" stroke="#0a0a0a" stroke-width="26" paint-order="stroke"/>
</svg>`)
fs.writeFileSync(path.join(out, 'icon.png'), renderIcon(1024))
fs.writeFileSync(path.join(out, 'icon-512.png'), renderIcon(512))
const entries = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256].map((size) => ({ size, buf: renderIcon(size) }))
fs.writeFileSync(path.join(out, 'icon-256.png'), entries[entries.length - 1].buf)
fs.writeFileSync(path.join(out, 'icon.ico'), ico(entries))
fs.writeFileSync(path.join(out, 'trayTemplate.png'), renderTray(18))
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), renderTray(36))
console.log('done')
