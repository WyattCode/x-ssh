/**
 * Where the main window opens.
 *
 * The window used to open centred on whichever display the mouse pointer was
 * on, and never remembered its position. Reading the code that looks like a
 * deliberate multi-monitor feature; using it, it looks like the app "opens on
 * the wrong screen" — move the pointer to a second monitor and the next launch
 * starts there, with no way to say otherwise, because nothing about the
 * position was ever saved.
 *
 * The rule now: reopen where it was last closed, on the display it was on.
 * The pointer only decides for a first run.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface DisplayInfo {
  id: number
  /** Usable area — excludes the taskbar, which is why y is often not 0. */
  workArea: Rect
}

export interface SavedPlacement {
  x?: number
  y?: number
  width?: number
  height?: number
  displayId?: number
}

export interface Placement {
  /** The display the window belongs on. */
  workArea: Rect
  /** Top-left to use, or undefined to centre within `workArea`. */
  x?: number
  y?: number
}

/** Whether a point lies inside a rectangle. */
function inside(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height
}

/**
 * How much of `rect` is visible on `workArea`, as a fraction of its area.
 * A window that is 90% off-screen is not "restored", it is lost.
 */
function visibleFraction(rect: Rect, workArea: Rect): number {
  const left = Math.max(rect.x, workArea.x)
  const top = Math.max(rect.y, workArea.y)
  const right = Math.min(rect.x + rect.width, workArea.x + workArea.width)
  const bottom = Math.min(rect.y + rect.height, workArea.y + workArea.height)
  if (right <= left || bottom <= top) return 0
  return ((right - left) * (bottom - top)) / (rect.width * rect.height)
}

/**
 * Whether the title bar can actually be grabbed on `workArea`.
 *
 * Area alone is the wrong test: a window with its top edge above the screen
 * can have plenty of pixels visible while offering no way to drag it back —
 * which is how a window gets permanently stuck. This checks the strip the user
 * grabs, not the whole rect.
 */
function titleBarReachable(rect: Rect, workArea: Rect, titleBarHeight = 40): boolean {
  const left = Math.max(rect.x, workArea.x)
  const right = Math.min(rect.x + rect.width, workArea.x + workArea.width)
  if (right - left < 120) return false // too little width to hit reliably
  const top = rect.y
  return top >= workArea.y && top + titleBarHeight <= workArea.y + workArea.height
}

/** The display centre-point of a rect, i.e. which monitor it is "on". */
function displayFor(displays: DisplayInfo[], rect: Rect): DisplayInfo | undefined {
  const cx = rect.x + Math.round(rect.width / 2)
  const cy = rect.y + Math.round(rect.height / 2)
  return displays.find((d) => inside(d.workArea, cx, cy))
}

/**
 * Chooses the display and top-left for a new window.
 *
 * `saved` is only trusted once it has been checked against the *current*
 * display layout: monitors get unplugged, resolutions change, and a laptop
 * docked yesterday may be alone today. A window whose saved position would put
 * most of itself outside every display is re-centred on the display it
 * remembers (or the primary one) instead of being restored into empty space.
 */
export function pickWindowPlacement(
  saved: SavedPlacement | undefined,
  ctx: {
    displays: DisplayInfo[]
    primaryId: number
    cursor: { x: number; y: number }
  }
): Placement {
  const { displays, primaryId, cursor } = ctx
  const primary = displays.find((d) => d.id === primaryId) ?? displays[0]
  if (!primary) {
    // No display information at all (headless CI, a broken driver). Nothing to
    // place against; let Electron pick.
    return { workArea: { x: 0, y: 0, width: 1280, height: 800 } }
  }

  const hasPosition = typeof saved?.x === 'number' && typeof saved?.y === 'number'
  if (!hasPosition || !saved) {
    // First run: centre on the display under the pointer, which is the only
    // signal we have about where the user is looking.
    const under = displays.find((d) => inside(d.workArea, cursor.x, cursor.y)) ?? primary
    return { workArea: under.workArea }
  }

  const rect: Rect = {
    x: saved.x as number,
    y: saved.y as number,
    width: saved.width ?? 1200,
    height: saved.height ?? 800
  }
  // Restore only if a usable part of the window is on a display AND the title bar
  // can still be grabbed there. Half a window hanging off an edge is fine (the
  // user may have put it there); a window whose title bar is above the screen
  // is not, because there is no way to drag it back.
  //
  // The area threshold is deliberately low: at 50% a window straddling two
  // monitors would be "lost" and jump on every launch, which is worse than
  // honouring a position the user chose.
  const usable = displays.some(
    (d) => visibleFraction(rect, d.workArea) >= 0.3 && titleBarReachable(rect, d.workArea)
  )
  if (usable) return { workArea: displayFor(displays, rect)?.workArea ?? primary.workArea, x: rect.x, y: rect.y }

  // Off-screen. Prefer the display it was last on, then the primary — the same
  // monitor is less jarring than a jump, and the primary is always reachable.
  const remembered = saved.displayId !== undefined ? displays.find((d) => d.id === saved.displayId) : undefined
  return { workArea: (remembered ?? primary).workArea }
}

/** Display id for persisting where the window ended up. */
export function displayIdForBounds(
  displays: DisplayInfo[],
  primaryId: number,
  bounds: Rect
): number {
  return displayFor(displays, bounds)?.id ?? primaryId
}