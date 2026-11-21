// Horizontal logo PNGs (desktop, Android, iOS): the flat X mark + the original "SSH" lettering at the same height,
// rendered with Chromium and cropped to the ink. Same geometry as src/renderer/src/components/BrandLockup.vue.
// Needs the dev app running with --remote-debugging-port=9333 (it only supplies a Chromium to draw in).
//   node build/icon-src/flat/lockup.cjs            writes every file listed in JOBS
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')
const ROOT = path.join(__dirname, '..', '..', '..')

const BACK = 'M659.49,237.62 A63,63 0 0,1 703.71,219.5 L786.18,219.5 A63,63 0 0,1 830.39,327.38 L364.51,786.38 A63,63 0 0,1 320.29,804.5 L237.82,804.5 A63,63 0 0,1 193.61,696.62 Z'
const FRONT = 'M193.61,327.38 A63,63 0 0,1 237.82,219.5 L320.29,219.5 A63,63 0 0,1 364.51,237.62 L830.39,696.62 A63,63 0 0,1 786.18,804.5 L703.71,804.5 A63,63 0 0,1 659.49,786.38 Z'
const COLORS = {
  dark: { front: '#f2f2f2', back: '#23d18b', text: '#ececec' },
  light: { front: '#1a1d23', back: '#1a833a', text: '#1a1d23' }
}

const SW = 90, HW = 110, GAP = 21, ST = 22, R = 19.5, HH = ST / 2
const S_PATH = `M${SW * 0.955},${HH} H${HH + R} A${R},${R} 0 0 0 ${HH},${HH + R} V${50 - R} A${R},${R} 0 0 0 ${HH + R},50 H${SW - HH - R} A${R},${R} 0 0 1 ${SW - HH},${50 + R} V${100 - HH - R} A${R},${R} 0 0 1 ${SW - HH - R},${100 - HH} H${SW * 0.035}`
const H_PATH = `M0,0H${ST}V${50 - ST / 2}H${HW - ST}V0H${HW}V100H${HW - ST}V${50 + ST / 2}H${ST}V100H0Z`
const WORD_W = SW + GAP + SW + GAP + HW
const K = 5.85, TEXT_X = 664 + 306, TEXT_Y = (612 - 585) / 2, TOTAL_W = TEXT_X + WORD_W * K

function lockupHtml(H, c) {
  return `<div id="lk" style="position:fixed;left:0;top:0;background:transparent;z-index:99999">
    <svg height="${H}" width="${((H * TOTAL_W) / 612).toFixed(2)}" viewBox="0 0 ${TOTAL_W} 612" style="display:block">
      <defs><mask id="gap" maskUnits="userSpaceOnUse" x="0" y="0" width="1024" height="1024"><rect width="1024" height="1024" fill="#fff"/><path d="${FRONT}" fill="#000" stroke="#000" stroke-width="30" stroke-linejoin="round"/></mask></defs>
      <g transform="translate(-180 -206)"><path d="${BACK}" fill="${c.back}" mask="url(#gap)"/><path d="${FRONT}" fill="${c.front}"/></g>
      <g transform="translate(${TEXT_X} ${TEXT_Y}) scale(${K})" fill="${c.text}"><path d="${S_PATH}" fill="none" stroke="${c.text}" stroke-width="${ST}"/><path d="${S_PATH}" fill="none" stroke="${c.text}" stroke-width="${ST}" transform="translate(${SW + GAP} 0)"/><path d="${H_PATH}" transform="translate(${2 * (SW + GAP)} 0)"/></g>
    </svg></div>`
}

function decodePng(buf) {
  let p = 8, w = 0, h = 0, ct = 0
  const idat = []
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); ct = d[9] } else if (type === 'IDAT') idat.push(d)
    p += 12 + len
  }
  if (ct !== 6) throw new Error('expected an RGBA png')
  const raw = zlib.inflateSync(Buffer.concat(idat)), bpp = 4, stride = w * bpp, out = Buffer.alloc(h * stride)
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[y * stride + x - bpp] : 0, b = y ? out[(y - 1) * stride + x] : 0, c = x >= bpp && y ? out[(y - 1) * stride + x - bpp] : 0
      let v = row[x]
      if (f === 1) v += a
      else if (f === 2) v += b
      else if (f === 3) v += (a + b) >> 1
      else if (f === 4) { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c }
      out[y * stride + x] = v & 255
    }
  }
  return { w, h, px: out }
}
function encodePng(w, h, px) {
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}
/** Crops to the opaque part (alpha > 6): no empty margin. */
function cropInk(buf) {
  const { w, h, px } = decodePng(buf)
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y }
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1, out = Buffer.alloc(cw * ch * 4)
  for (let y = 0; y < ch; y++) px.copy(out, y * cw * 4, ((y0 + y) * w + x0) * 4, ((y0 + y) * w + x1 + 1) * 4)
  return { w: cw, h: ch, buf: encodePng(cw, ch, out) }
}

// Target ink heights in px: the ink is 585/612 of the box, so the box is drawn a little taller.
const box = (ink) => Math.round(ink / (585 / 612))
const JOBS = [
  { out: 'src/renderer/src/assets/logo-dark.png', ink: 192, theme: 'dark' },
  { out: 'src/renderer/src/assets/logo-light.png', ink: 192, theme: 'light' },
  { out: 'mobile/ios/XSSH/Assets.xcassets/LogoLockup.imageset/lockup.png', ink: 112, theme: 'dark' }
]
for (const [d, ink] of [['mdpi', 28], ['hdpi', 42], ['xhdpi', 56], ['xxhdpi', 84], ['xxxhdpi', 112]]) {
  for (const theme of ['dark', 'light']) JOBS.push({ out: `mobile/android/app/src/main/res/drawable-${d}/logo_lockup_${theme}.png`, ink, theme })
}

;(async () => {
  const list = await (await fetch('http://127.0.0.1:9333/json')).json()
  const page = list.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map()
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id) } }
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.result.value
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }); await send('Page.bringToFront')
  await ev('window.api.zoom.set(0)')
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 700, deviceScaleFactor: 1, mobile: false })
  await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  for (const job of JOBS) {
    const H = box(job.ink)
    await ev(`(()=>{document.getElementById('lk')?.remove();document.documentElement.style.background='transparent';document.body.style.background='transparent';const app=document.getElementById('app');if(app)app.style.visibility='hidden';document.body.insertAdjacentHTML('beforeend',${JSON.stringify(lockupHtml(H, COLORS[job.theme]))})})()`)
    await new Promise((r) => setTimeout(r, 350))
    const size = await ev(`(()=>{const b=document.querySelector('#lk svg').getBoundingClientRect();return [b.width,b.height]})()`)
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: Math.ceil(size[0]), height: Math.ceil(size[1]), scale: 1 }, fromSurface: true })
    const c = cropInk(Buffer.from(shot.result.data, 'base64'))
    fs.writeFileSync(path.join(ROOT, job.out), c.buf)
    console.log(job.out, c.w + 'x' + c.h)
  }
  await ev(`(()=>{document.getElementById('lk')?.remove();const app=document.getElementById('app');if(app)app.style.visibility='';document.documentElement.style.background='';document.body.style.background=''})()`)
  await send('Emulation.setDefaultBackgroundColorOverride', {})
  await send('Emulation.clearDeviceMetricsOverride')
  ws.close()
})().catch((e) => { console.error('ERR', e.message); process.exit(1) })
