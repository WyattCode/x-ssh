import { describe, it, expect } from 'vitest'
import { snippetVars, fillSnippetText, useSnippetVars } from './snippetVars'
import type { Snippet } from '../../../shared/types'

function snip(text: string): Snippet {
  return { id: 's1', title: 't', text }
}

describe('snippetVars', () => {
  it('extracts distinct placeholders in order', () => {
    expect(snippetVars(snip('ssh {user}@{host} -p {port}'))).toEqual(['user', 'host', 'port'])
  })

  it('de-duplicates repeated placeholders', () => {
    expect(snippetVars(snip('cp {name} {name}.bak'))).toEqual(['name'])
  })

  it('ignores non-word braces and returns empty when none', () => {
    expect(snippetVars(snip('echo {x-y} ok'))).toEqual([])
    expect(snippetVars(snip('plain command'))).toEqual([])
  })
})

describe('fillSnippetText', () => {
  it('replaces every occurrence of a placeholder', () => {
    expect(fillSnippetText('cp {name} {name}.bak', [{ name: 'name', value: 'a.txt' }])).toBe(
      'cp a.txt a.txt.bak'
    )
  })

  it('leaves unknown braces alone', () => {
    expect(fillSnippetText('echo {a} {b}', [{ name: 'a', value: '1' }])).toBe('echo 1 {b}')
  })
})

describe('useSnippetVars', () => {
  it('cancels the in-flight prompt when a second one opens', async () => {
    const { state, prompt, cancel } = useSnippetVars()
    const first = prompt(snip('ssh {user}@{host}'))
    expect(state.open).toBe(true)
    // A second prompt must not orphan the first awaiter.
    const second = prompt(snip('ssh {user}@{host}'))
    await expect(first).resolves.toBeNull()
    expect(state.open).toBe(true)
    expect(state.vars.map((v) => v.name)).toEqual(['user', 'host'])
    cancel()
    await expect(second).resolves.toBeNull()
    expect(state.open).toBe(false)
  })

  it('closes the dialog when a var-less follow-up cancels the in-flight prompt', async () => {
    const { state, prompt } = useSnippetVars()
    const first = prompt(snip('ssh {user}@{host}'))
    expect(state.open).toBe(true)
    const text = await prompt(snip('echo hello'))
    await expect(first).resolves.toBeNull()
    expect(text).toBe('echo hello')
    expect(state.open).toBe(false)
    expect(state.resolve).toBeNull()
  })
})
