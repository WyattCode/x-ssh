# ime-e2e

Drives **real Chromium IME events** (CDP `Input.imeSetComposition` / `Input.insertText`)
through **real xterm.js** and the **real IME bridge** (`src/renderer/src/lib/imeBridge.ts`),
then checks what a pretend remote line editor ends up holding.

Why it exists: the voice-input duplication bug survived six fixes because the unit-test
harness replayed an *assumed* event order and a textarea that only ever held the current
draft. Real xterm never empties its textarea between commits, so it accumulates.

No Node on PATH? Use Electron's: set `ELECTRON_RUN_AS_NODE=1` for the build step.

```bash
ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron.exe scripts/ime-e2e/build.cjs
node_modules/electron/dist/electron.exe scripts/ime-e2e/run.cjs      # opens a window briefly
```

Needs a desktop session (it creates a visible window). Not part of `vitest`.
