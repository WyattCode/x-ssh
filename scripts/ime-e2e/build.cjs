// Bundles entry.ts + page.html + xterm.css into .out/ (run with ELECTRON_RUN_AS_NODE=1).
const esbuild = require('esbuild')
const fs = require('fs')
const path = require('path')
const out = path.join(__dirname, '.out')
fs.mkdirSync(out, { recursive: true })
esbuild.buildSync({
  entryPoints: [path.join(__dirname, process.argv[2] || 'entry.ts')],
  bundle: true,
  outfile: path.join(out, 'bundle.js'),
  platform: 'browser',
  logLevel: 'warning'
})
for (const f of ['page.html', 'xterm.css']) fs.copyFileSync(path.join(__dirname, f), path.join(out, f))
console.log('built', out)
