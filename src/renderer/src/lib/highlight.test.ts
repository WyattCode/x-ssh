import { describe, it, expect } from 'vitest'
import { highlight, langFromName } from './highlight'

describe('langFromName', () => {
  it('maps common extensions', () => {
    expect(langFromName('main.ts')).toBe('ts')
    expect(langFromName('app.js')).toBe('js')
    expect(langFromName('pkg.json')).toBe('json')
    expect(langFromName('run.sh')).toBe('sh')
    expect(langFromName('do.yaml')).toBe('yml')
    expect(langFromName('index.html')).toBe('xml')
    expect(langFromName('style.css')).toBe('css')
    expect(langFromName('query.sql')).toBe('sql')
  })
  it('returns empty for unknown', () => {
    expect(langFromName('notes.txt')).toBe('')
    expect(langFromName('readme')).toBe('')
  })
})

describe('highlight', () => {
  it('escapes html in unknown languages', () => {
    expect(highlight('<b>hi</b> & stuff', '')).toBe('&lt;b&gt;hi&lt;/b&gt; &amp; stuff')
  })
  it('highlights js keywords and strings', () => {
    const out = highlight('const x = "hi";', 'js')
    expect(out).toContain('<span class="k">const</span>')
    expect(out).toContain('<span class="s">"hi"</span>')
  })
  it('highlights line comments and numbers', () => {
    const out = highlight('// note\nlet a = 42', 'js')
    expect(out).toContain('<span class="c">// note</span>')
    expect(out).toContain('<span class="n">42</span>')
  })
  it('highlights block comments', () => {
    const out = highlight('/* multi\nline */ x', 'js')
    expect(out).toContain('<span class="c">/* multi\nline */</span>')
  })
  it('treats single quotes as strings', () => {
    const out = highlight("const s = 'x';", 'js')
    expect(out).toContain('<span class="s">\'x\'</span>')
  })
  it('handles escaped quotes inside strings', () => {
    const out = highlight('const a = "q\\"q";', 'js')
    expect(out).toContain('<span class="s">"q\\"q"</span>')
  })
  it('preserves newlines as plain text (not escaped to entities)', () => {
    const out = highlight('a\nb', 'js')
    expect(out).toBe('a\nb')
  })
  it('marks ts member access', () => {
    const out = highlight('this.foo.bar', 'ts')
    expect(out).toContain('<span class="k">this</span>')
    expect(out).toContain('<span class="m">foo</span>')
  })
  it('renders json keys', () => {
    const out = highlight('{"a": 1}', 'json')
    expect(out).toContain('<span class="s">"a"</span>')
    expect(out).toContain('<span class="n">1</span>')
  })
})
