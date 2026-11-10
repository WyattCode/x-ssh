# ime-e2e

Drives **real Chromium IME events** (CDP `Input.imeSetComposition` / `Input.insertText` /
`Input.dispatchKeyEvent` / `Input.dispatchMouseEvent`) through **real xterm.js** and the
**real IME bridge** (`src/renderer/src/lib/imeBridge.ts`), then checks what a pretend remote
line editor ends up holding (DEL erases, CR/LF outside a bracketed paste submits the line).

Why it exists: the voice-input duplication bug survived several fixes because the unit-test
harness replayed an *assumed* event order. Real xterm never empties its textarea between
commits, and the real Doubao flow is one long composition with a fake keyCode-252 key in the
middle (see `HANDOVER.md` M3.190). The scenarios here are the ones that failed on a real
machine; several were also checked to fail against the previous implementation.

No Node on PATH? Use Electron's: set `ELECTRON_RUN_AS_NODE=1` for the build step.

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/ime-e2e/build.cjs
node_modules/electron/dist/electron.exe scripts/ime-e2e/run.cjs
```

The window is not shown and the page is given CDP focus emulation, so the run never takes
keyboard focus from whatever else is open. If xterm still sees a blur (it empties its textarea
on blur) that run is discarded and retried; a scenario that cannot get a clean run is reported
as SKIP and the exit code is non-zero. Not part of `vitest`.

## Reading `ime-trace.log`

The log records the **shape** of every payload, not its text: `{ chars, dels, breaks, esc, id }`.

```json
{"t":184,"kind":"SEND","data":{"chars":46,"dels":0,"breaks":0,"esc":false,"id":"1k3x9p"},"ta":{"chars":46,...}}
```

- `chars` — length in code points (how much the IME committed).
- `dels` — how many `\x7f` we emitted (how much we erased).
- `breaks` — line breaks inside the payload (multi-line tidy-up).
- `id` — same id on two entries means the same text; that is how you tell "the IME re-sent the
  same sentence" from "it sent a new one", without the log containing the sentence.

This replaced verbatim text on purpose: with tracing enabled, a password typed into a Chinese
IME at a `sudo` prompt (the pinyin string lands in the textarea first) used to be written to
this file in plain text. If you genuinely need the characters, attach a debugger to the renderer
and read the textarea — do not put them back into the file.
