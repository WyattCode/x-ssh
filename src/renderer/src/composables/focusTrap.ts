import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue'

/**
 * Keeps Tab / Shift+Tab inside a modal element while it is open.
 *
 * Every dialog here binds Esc/Enter on its own root, and several declare
 * `aria-modal="true"` — but without a trap Tab walks straight out to the
 * (visually hidden) background, so keyboard users end up typing into the
 * page behind the dialog, and Esc stops working because focus left the
 * subtree that listens for it.
 *
 * Attach one per modal:
 *
 *     const panelEl = ref<HTMLElement>()
 *     useFocusTrap(panelEl, () => props.open)
 *
 * The element should be focusable itself (`tabindex="-1"`) so that opening a
 * dialog with no interactive content still leaves focus inside it.
 */

/** Elements that can hold focus. Kept intentionally close to the HTML spec's
 *  focusable set — a broader list (e.g. `[tabindex]`) would trap on the
 *  dialog root itself and break the Tab cycle. */
const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])'
].join(',')

function focusableWithin(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      // offsetParent is null for display:none / detached nodes; getClientRects
      // catches the fixed-position case where offsetParent is also null.
      (el.offsetParent !== null || el.getClientRects().length > 0) &&
      el.getAttribute('aria-hidden') !== 'true'
  )
}

/** Traps that are open, outermost first. A dialog opened on top of another
 *  (a confirm over a host editor) must be the only one handling Tab: with both
 *  listening, the lower trap pulls focus back into a panel the user cannot see,
 *  and the upper one drags it to its first item again — Tab never moves. */
const openTraps: object[] = []

export function useFocusTrap(el: Ref<HTMLElement | undefined>, isOpen: () => boolean): void {
  const token = {}
  function onKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return
    if (openTraps[openTraps.length - 1] !== token) return
    const root = el.value
    if (!root) return
    const items = focusableWithin(root)
    if (!items.length) {
      // Nothing to focus inside: keep focus on the dialog itself rather than
      // letting Tab escape to the page behind.
      e.preventDefault()
      root.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement as HTMLElement | null
    // Focus outside the dialog (or on the root) counts as "not in the cycle":
    // pull it back in on the first Tab.
    const inside = !!active && root.contains(active) && active !== root
    if (!inside) {
      e.preventDefault()
      ;(e.shiftKey ? last : first).focus()
      return
    }
    if (e.shiftKey && active === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  // Bind on the document (capture) rather than the element: focus can already
  // have escaped when the trap installs, and a document listener keeps working
  // regardless of where focus currently sits.
  //
  // Both the first read and the watcher wait for mount: callers tend to declare
  // the trap above the state it reads (`useFocusTrap(el, () => store.open)`
  // before `const store = ...`), and touching that binding during setup throws
  // a TDZ error that Vue swallows — leaving the trap silently uninstalled.
  let stop: (() => void) | undefined
  function sync(open: boolean): void {
    const index = openTraps.indexOf(token)
    if (open && index === -1) {
      document.addEventListener('keydown', onKeydown, true)
      openTraps.push(token)
    } else if (!open && index !== -1) {
      document.removeEventListener('keydown', onKeydown, true)
      openTraps.splice(index, 1)
    }
  }
  onMounted(() => {
    sync(isOpen())
    stop = watch(isOpen, sync)
  })
  onBeforeUnmount(() => {
    stop?.()
    const index = openTraps.indexOf(token)
    if (index !== -1) {
      document.removeEventListener('keydown', onKeydown, true)
      openTraps.splice(index, 1)
    }
  })
}