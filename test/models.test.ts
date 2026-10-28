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

  // 0.3.2: removed / renamed upstream. Not a breaking change: RouvaModel ends with
  // (string & {}), so these ids still type-check — only autocomplete drops them.
  it.each(['gpt-4.1-nano', 'deepseek-v4-flash', 'deepseek-v4-flash-think', 'deepseek-flash-4-1'])('does not list removed %s', (id) => {
    expect(types).not.toContain(`| '${id}'`)
  })
  it.each(['deepseek-flash', 'deepseek-flash-think', 'deepseek-v4-pro', 'gpt-6-luna'])('lists %s', (id) => {
    expect(types).toContain(`| '${id}'`)
  })

  // 0.5.1: models the gateway added 2026-10-25 / 2026-10-27, and the MiniMax provider.
  it.each(['gpt-6-astra', 'gpt-6.1-terra', 'claude-haiku-5-5', 'gemini-4-argon', 'kimi-k3.1-pro', 'MiniMax-M3.1-Flash', 'MiniMax-M3'])('lists %s', (id) => {
    expect(types).toContain(`| '${id}'`)
  })
  it('lists the minimax provider', () => {
    expect(types).toMatch(/export type RouvaProvider =[^;]*\| 'minimax'/)
  })
})
