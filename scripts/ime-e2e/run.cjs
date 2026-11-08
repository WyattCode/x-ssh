// Drives real Chromium IME events (CDP Input.imeSetComposition / insertText /
// dispatchKeyEvent / dispatchMouseEvent) through real xterm.js + the real IME
// bridge, and checks the remote line.
//
//   build:  ELECTRON_RUN_AS_NODE=1 electron build.cjs
//   run:    electron run.cjs [bundleDir]        (needs a desktop session)
const { app, BrowserWindow } = require('electron')
const path = require('path')

const dir = path.resolve(process.argv[2] || path.join(__dirname, '.out'))
const V1 = '你好，我今天希望吃饭，吃了饭之后再吃，首先其一'
const V2 = '你好，我今天希望吃饭，吃了饭之后再吃。首先，其一。'
const T1 = '你好啊，我有三个想法，第一呢吃个饭，第二呢吃冰棍，第三呢再吃'
const T2 = '你好啊，我有三个想法：\n1. 吃个饭。\n2. 吃冰棍。\n3. 再吃个饭。'
// The real Doubao capture (device trace, 2026-11-08): draft forced out mid-composition,
// then the tidied, multi-line version replaces it.
const D1 = '今天我要吃个饭，第一我要吃米饭，第二，我要吃土豆，第三我要吃水饺，第四我要吃番茄，第五我要吃'
const D2 = '今天我要吃个饭：\n1. 米饭\n2. 土豆\n3. 水饺\n4. 番茄\n5. 猪肉'

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 900, height: 400, show: false, webPreferences: { sandbox: false } })
  await win.loadFile(path.join(dir, 'page.html'))

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
  /** The fake key Doubao fires mid-dictation (key "Unidentified", keyCode 252). */
  const key252 = async () => {
    await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 252, key: 'Unidentified' })
    await cdp('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 252, key: 'Unidentified' })
    await settle()
  }
  const moveMouse = async (n) => {
    for (let i = 0; i < n; i++) {
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 60 + i * 9, y: 40 + i * 5 })
      await sleep(15)
    }
    await settle()
  }
  const reset = async () => {
    await ev('window.__reset()')
    await ev('document.querySelector("textarea").focus()')
    await settle()
  }

  // opts: bracketed = the app has bracketed paste on (bash / Codex); mouse = TUI mouse reports on
  const scenarios = [
    ['append, no composition (textarea V1V2)', V2, {}, async () => { await insert(V1); await insert(V2) }],
    ['composition commit twice (textarea V1V2)', V2, {}, async () => {
      await compose(V1); await insert(V1); await compose(V2); await insert(V2)
    }],
    ['select-all then insertText (textarea V2)', V2, {}, async () => {
      await insert(V1); await ev('window.__selectAll()'); await insert(V2)
    }],
    ['reconversion: composition replaces V1 in place', V2, {}, async () => {
      await compose(V1); await insert(V1)
      await compose(V2, [0, V1.length]); await insert(V2)
    }],
    ['IME deletes V1 then inserts V2', V2, {}, async () => {
      await insert(V1); await ev('window.__selectAll()'); await ev('document.execCommand("delete")'); await settle(); await insert(V2)
    }],
    // NOT covered: short drafts re-posted by APPENDING (对 / 对对 / 对的，谢谢你 → textarea
    // 对对对对的，谢谢你). Indistinguishable from the user saying separate words, so they
    // are kept; revisions are only recognised from a 3-character shared phrase.
    ['three passes (select-all replace each time)', '对的，谢谢你', {}, async () => {
      await insert('对'); await ev('window.__selectAll()'); await insert('对对'); await ev('window.__selectAll()'); await insert('对的，谢谢你')
    }],
    ['unrelated sentences are both kept', '重启服务查看磁盘', {}, async () => { await insert('重启服务'); await insert('查看磁盘') }],
    ['typed text survives a later dictation', 'ls -l 看看日志', {}, async () => { await type('ls -l '); await insert('看看日志') }],
    ['dictation then typed text then dictation', '看看日志 | 再看看报错信息', {}, async () => {
      await insert('看看日志'); await type(' | '); await insert('再看看报错信息')
    }],
    ['longer take: draft then draft+tail', '把日志清理一下', {}, async () => { await insert('把日志'); await insert('把日志清理一下') }],
    // Doubao "智能文字整理": a model restructures the dictation into lines / lists.
    ['tidy-up with line breaks (textarea V1V2)', T2, { bracketed: true }, async () => { await insert(T1); await insert(T2) }],
    ['tidy-up with line breaks (select-all replace)', T2, { bracketed: true }, async () => {
      await insert(T1); await ev('window.__selectAll()'); await insert(T2)
    }],
    ['tidy-up with line breaks (composition reconversion)', T2, { bracketed: true }, async () => {
      await compose(T1); await insert(T1)
      await compose(T2, [0, T1.length]); await insert(T2)
    }],
    ['same draft posted twice', '检查所有细节', {}, async () => { await insert('检查所有细节'); await insert('检查所有细节') }],

    // ---- the real device flow, and the ways it used to break ----
    ['REAL FLOW: keyCode-252 forces the draft out, tidy-up replaces it', D2, { bracketed: true }, async () => {
      await compose(D1); await key252(); await compose(D2); await insert(D2)
    }],
    ['REAL FLOW + mouse reports between draft and tidy-up (Codex)', D2, { bracketed: true, mouse: true }, async () => {
      await compose(D1); await key252(); await moveMouse(6); await compose(D2); await moveMouse(4); await insert(D2)
    }],
    ['REAL FLOW without bracketed paste still erases the draft', '今天我要吃个饭：', { }, async () => {
      // single line, so nothing here depends on how LF is delivered
      await compose(D1); await key252(); await compose('今天我要吃个饭：'); await insert('今天我要吃个饭：')
    }],
    ['arrow key between draft and rewrite keeps the correction working', V2, {}, async () => {
      await insert(V1)
      await cdp('Input.dispatchKeyEvent', { type: 'rawKeyDown', windowsVirtualKeyCode: 38, key: 'ArrowUp' })
      await cdp('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: 38, key: 'ArrowUp' })
      await settle()
      await ev('window.__selectAll()'); await insert(V2)
    }],
    ['app paste after a dictation is neither erased nor mistaken for a rewrite', '你好世界这是草稿你好世界这是粘贴', {}, async () => {
      await insert('你好世界这是草稿'); await ev('window.__pasteLater("你好世界这是粘贴")'); await sleep(120)
    }]
  ]

  // The page is made to believe it is focused (CDP focus emulation) instead of
  // grabbing OS focus: stealing focus would send the user's own keystrokes into
  // this window, and losing it makes xterm empty its textarea mid-scenario.
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true })
  const focused = async () => {
    for (let i = 0; i < 20; i++) {
      await ev('document.querySelector("textarea").focus()')
      if (await ev('window.__hasFocus()')) return true
      await sleep(100)
    }
    return false
  }

  let failed = 0
  let invalid = 0
  for (const [name, want, opts, run] of scenarios) {
    let got, rawLf
    let valid = false
    for (let attempt = 1; attempt <= 4 && !valid; attempt++) {
      await ev('window.__reset()')
      if (!(await focused())) continue
      await ev(`window.__bracketed(${!!opts.bracketed})`)
      await ev(`window.__mouseTracking(${!!opts.mouse})`)
      await sleep(40)
      await run()
      await sleep(80)
      got = await ev('window.__remote()')
      rawLf = await ev('window.__rawLf()')
      valid = (await ev('window.__blurs()')) === 0
    }
    if (!valid) {
      invalid++
      console.log(`SKIP  ${name}  (window kept losing focus; result not trustworthy)`)
      continue
    }
    const ok = got === want && rawLf === 0
    if (!ok) failed++
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) {
      console.log('   want:', JSON.stringify(want))
      console.log('   got :', JSON.stringify(got), rawLf ? `(raw LF outside a paste: ${rawLf})` : '')
      console.log('   wire:', JSON.stringify(await ev('window.__wire()')))
      console.log('   ta  :', JSON.stringify(await ev('window.__ta()')))
    }
  }
  console.log(failed ? `\n${failed} FAILED` : invalid ? `\nno failures, but ${invalid} scenario(s) skipped` : '\nall passed')
  app.exit(failed || invalid ? 1 : 0)
})
