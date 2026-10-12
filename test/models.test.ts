import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Alibaba retired these on 2026-10-10; calls to them fail upstream, so the
// SDK must not offer them as RouvaModel suggestions.
describe('RouvaModel', () => {
  const types = readFileSync(new URL('../src/types.ts', import.meta.url), 'utf8')
  it.each(['qwen-turbo', 'qwen3-235b-a22b', 'qwen3-32b', 'qwen3-30b-a3b'])('does not list retired %s', (id) => {
    expect(types).not.toContain(`| '${id}'`)
  })
  it.each(['qwen-flash', 'qwen3.8-flash', 'qwen3.7-plus'])('lists %s', (id) => {
    expect(types).toContain(`| '${id}'`)
  })
})
