// Drives real Chromium IME events (CDP Input.imeSetComposition / insertText)
// through real xterm.js + the real IME bridge, and checks the remote line.
//
//   build:  esbuild entry.ts --bundle --outfile=.out/bundle.js   (see run.md)
//   run:    ELECTRON_RUN_AS_NODE unset;  electron run.cjs [bundleDir]
const { app, BrowserWindow } = require('electron')
const fs = require('fs')
const path = require('path')

const dir = path.resolve(process.argv[2] || path.join(__dirname, '.out'))
const V1 = '你好，我今天希望吃饭，吃了饭之后再吃，首先其一'
const V2 = '你好，我今天希望吃饭，吃了饭之后再吃。首先，其一。'

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 400, show: true, webPreferences: { sandbox: false } })
  await win.loadFile(path.join(dir, 'page.html'))
  win.focus()
  const wc = win.webContents
  const dbg = wc.debugger
  dbg.attach('1.3')
  const cdp = (m, p) => dbg.sendCommand(m, p)
  const ev = (code) => wc.executeJavaScript(code)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const settle = () => sleep(60)

  // Input.insertText leaves the caret at the START of what it inserted (a CDP
  // quirk: ImeCommitText with relative_cursor_pos 0). A real IME leaves it
  // after the commit, so put it there or the next commit lands in front.
  const insert = async (text) => {
    await cdp('Input.insertText', { text }); await settle()
    await ev('window.__caretToEnd()'); await settle()
  }
  const compose = async (text, repl) => {
    await cdp('Input.imeSetComposition', {
      text, selectionStart: text.length, selectionEnd: text.length,
      ...(repl ? { replacementStart: repl[0], replacementEnd: repl[1] } : {})
    })
    await settle()
  }
  const type = async (s) => {
    for (const ch of s) {
      await cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch, unmodifiedText: ch })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
      await settle()
    }
  }
  const reset = async () => { await ev('window.__reset()'); await ev('document.querySelector("textarea").focus()'); await settle() }

  const scenarios = [
    ['append, no composition (textarea V1V2)', V2, async () => { await insert(V1); await insert(V2) }],
    ['composition commit twice (textarea V1V2)', V2, async () => {
      await compose(V1); await insert(V1); await compose(V2); await insert(V2)
    }],
    ['select-all then insertText (textarea V2)', V2, async () => {
      await insert(V1); await ev('window.__selectAll()'); await insert(V2)
    }],
    ['reconversion: composition replaces V1 in place', V2, async () => {
      await compose(V1); await insert(V1)
      await compose(V2, [0, V1.length]); await insert(V2)
    }],
    ['IME deletes V1 then inserts V2', V2, async () => {
      await insert(V1); await ev('window.__selectAll()'); await ev('document.execCommand("delete")'); await settle(); await insert(V2)
    }],
    // NOT covered: short drafts re-posted by APPENDING (对 / 对对 / 对的，谢谢你 → textarea
    // 对对对对的，谢谢你). Indistinguishable from the user saying separate words, so they
    // are kept; revisions are only recognised from a 3-character shared phrase.
    ['three passes (select-all replace each time)', '对的，谢谢你', async () => {
      await insert('对'); await ev('window.__selectAll()'); await insert('对对'); await ev('window.__selectAll()'); await insert('对的，谢谢你')
    }],
    ['unrelated sentences are both kept', '重启服务查看磁盘', async () => { await insert('重启服务'); await insert('查看磁盘') }],
    ['typed text survives a later dictation', 'ls -l 看看日志', async () => { await type('ls -l '); await insert('看看日志') }],
    ['dictation then typed text then dictation', '看看日志 | 再看看报错信息', async () => {
      await insert('看看日志'); await type(' | '); await insert('再看看报错信息')
    }],
    ['longer take: draft then draft+tail', '把日志清理一下', async () => { await insert('把日志'); await insert('把日志清理一下') }],
    ['same draft posted twice', '检查所有细节', async () => { await insert('检查所有细节'); await insert('检查所有细节') }]
  ]

  let failed = 0
  for (const [name, want, run] of scenarios) {
    await reset()
    await run()
    await sleep(60)
    const got = await ev('window.__remote()')
    const ok = got === want
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) {
      console.log('   want:', want)
      console.log('   got :', got)
      console.log('   wire:', JSON.stringify(await ev('window.__wire()')))
      console.log('   ta  :', JSON.stringify(await ev('window.__ta()')))
    }
  }
  console.log(failed ? `\n${failed} FAILED` : '\nall passed')
  app.exit(failed ? 1 : 0)
})
