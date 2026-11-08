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
