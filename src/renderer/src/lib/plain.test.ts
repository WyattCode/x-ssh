import { describe, expect, it } from 'vitest'
import { reactive, readonly } from 'vue'
import { toPlain } from './plain'

/** What Electron's IPC does to every invoke argument. */
const clone = (v: unknown): unknown => structuredClone(v)

describe('toPlain', () => {
  it('makes a Pinia-style proxy cloneable', () => {
    const host = reactive({
      id: 'host-1',
      host: '192.168.10.212',
      os: { id: 'ubuntu', pretty: 'Ubuntu 26.04.1 LTS' }
    })
    // The bug: a nested proxy cannot cross IPC at all.
    expect(() => clone({ host })).toThrow()
    expect(() => clone({ host: toPlain(host) })).not.toThrow()
    expect(clone(toPlain(host))).toEqual({
      id: 'host-1',
      host: '192.168.10.212',
      os: { id: 'ubuntu', pretty: 'Ubuntu 26.04.1 LTS' }
    })
  })

  it('unwraps proxies nested in arrays', () => {
    const state = reactive({ hosts: [{ id: 'a', tags: ['x', 'y'] }] })
    expect(clone(toPlain(state))).toEqual({ hosts: [{ id: 'a', tags: ['x', 'y'] }] })
  })

  it('unwraps a readonly proxy too', () => {
    const ro = readonly({ id: 'a', port: 22 })
    expect(clone(toPlain(ro))).toEqual({ id: 'a', port: 22 })
  })

  it('keeps undefined values but drops functions', () => {
    const out = toPlain({ keyPath: undefined, onClick: () => 1, port: 22 })
    expect(clone(out)).toEqual({ keyPath: undefined, port: 22 })
  })

  it('passes primitives and null through untouched', () => {
    expect(toPlain(22)).toBe(22)
    expect(toPlain('x')).toBe('x')
    expect(toPlain(null)).toBeNull()
    expect(toPlain(undefined)).toBeUndefined()
  })
})
