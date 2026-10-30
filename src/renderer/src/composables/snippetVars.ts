import { reactive } from 'vue'
import type { Snippet } from '../../../shared/types'

export interface SnipVarField {
  name: string
  value: string
}

interface VarsState {
  open: boolean
  snippet: Snippet | null
  vars: SnipVarField[]
  resolve: ((text: string | null) => void) | null
  /** Name of the first variable left empty — the dialog highlights it. */
  error: string | null
}

// Shared, app-wide state driving a single SnippetVarsDialog host. A snippet
// whose text contains `{var}` placeholders is opened here so the user can fill
// each placeholder before it is sent.
const state = reactive<VarsState>({
  open: false,
  snippet: null,
  vars: [],
  resolve: null,
  error: null
})

/** Extracts the ordered, de-duplicated `{name}` placeholders from a snippet. */
export function snippetVars(snippet: Snippet): string[] {
  const names: string[] = []
  const re = /\{(\w+)\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(snippet.text))) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
}

/** Escapes a name for use inside a RegExp (placeholders are `\w+`, but the
 *  helper is exported and may be handed anything). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Substitutes every `{name}` occurrence in `template` with its value. */
export function fillSnippetText(template: string, vars: { name: string; value: string }[]): string {
  let text = template
  for (const v of vars) {
    text = text.replace(new RegExp(`\\{${escapeRe(v.name)}\\}`, 'g'), v.value)
  }
  return text
}

export function useSnippetVars(): {
  state: VarsState
  prompt: (snippet: Snippet) => Promise<string | null>
  submit: () => void
  cancel: () => void
} {
  function prompt(snippet: Snippet): Promise<string | null> {
    // A second prompt while the dialog is open (palette spam, a double
    // activate) used to overwrite `state.resolve`, leaving the first awaiter
    // pending forever. Tear the prior one down fully — including the dialog —
    // so a follow-up with no placeholders does not leave the sheet hanging
    // open with resolve already cleared.
    if (state.resolve) {
      const prev = state.resolve
      state.resolve = null
      state.open = false
      state.snippet = null
      state.vars = []
      state.error = null
      prev(null)
    }
    const names = snippetVars(snippet)
    if (!names.length) return Promise.resolve(snippet.text)
    return new Promise<string | null>((res) => {
      state.error = null
      state.snippet = snippet
      const defaults = snippet.defaultVars ?? {}
      state.vars = names.map((name) => ({ name, value: defaults[name] ?? '' }))
      state.resolve = res
      state.open = true
    })
  }
  function submit(): void {
    const r = state.resolve
    const snip = state.snippet
    if (!snip || !r) {
      state.open = false
      r?.(null)
      return
    }
    // An empty variable is almost always an unfinished form, and the filled-in
    // rest of the command still goes straight to the shell — block until the
    // user fills it in or cancels, instead of sending a mangled command.
    const missing = state.vars.find((v) => !v.value.trim())
    if (missing) {
      state.error = missing.name
      return
    }
    state.resolve = null
    state.open = false
    const text = fillSnippetText(snip.text, state.vars)
    r(text)
    state.snippet = null
    state.vars = []
  }
  function cancel(): void {
    const r = state.resolve
    state.resolve = null
    state.open = false
    r?.(null)
    state.snippet = null
    state.vars = []
  }
  return { state, prompt, submit, cancel }
}
