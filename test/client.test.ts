import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Rouva } from '../src'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let text = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) return text
    if (value) text += decoder.decode(value, { stream: true })
  }
}

describe('Rouva SDK client', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('authenticates with Authorization Bearer', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const rouva = new Rouva({ apiKey: 'rva_test_key', baseURL: 'https://app.rouva.io' })
    await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://app.rouva.io/api/gateway/messages',
      expect.objectContaining({
        headers: expect.objectContaining({
          'Authorization': 'Bearer rva_test_key',
        }),
      }),
    )
  })

  it('passes explicit provider overrides through to the gateway', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    })

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBe(JSON.stringify({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
      messages: [{ role: 'user', content: 'Hello' }],
    }))
  })

  it('parses OpenAI-style SSE into a chat completion object', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"role":"assistant"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-5-mini","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","created":1700000000,"model":"gpt-5-mini","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1,"total_tokens":4}}\n\n' +
      'data: [DONE]\n\n'
    ), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Rouva-Model': 'gpt-5-mini',
        'X-Rouva-Provider': 'openai',
        'X-Rouva-Task': 'code',
      },
    }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(res).toEqual({
      id: 'chatcmpl_123',
      object: 'chat.completion',
      created: 1700000000,
      model: 'gpt-5-mini',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hello' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 1,
        total_tokens: 4,
      },
      _rouva: {
        model_used: 'gpt-5-mini',
        provider_used: 'openai',
        task_type: 'code',
      },
    })
  })

  it('normalizes Anthropic SSE into a chat completion object', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":7,"output_tokens":0}}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    ), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'X-Rouva-Model': 'claude-sonnet-4-6',
        'X-Rouva-Provider': 'anthropic',
      },
    }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(res).toEqual({
      id: 'chatcmpl_msg_123',
      object: 'chat.completion',
      created: expect.any(Number),
      model: 'claude-sonnet-4-6',
      choices: [{
        index: 0,
        message: { role: 'assistant', content: 'Hi' },
        finish_reason: 'stop',
      }],
      usage: {
        prompt_tokens: 7,
        completion_tokens: 2,
        total_tokens: 9,
      },
      _rouva: {
        model_used: 'claude-sonnet-4-6',
        provider_used: 'anthropic',
      },
    })
  })

  it('normalizes Anthropic SSE to OpenAI-style chunks for streaming consumers', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":7,"output_tokens":0}}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hi"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":2}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    ), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const stream = await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true,
    })

    const text = await readStream(stream as ReadableStream<Uint8Array>)
    expect(text).toContain('"object":"chat.completion.chunk"')
    expect(text).toContain('"role":"assistant"')
    expect(text).toContain('"content":"Hi"')
    expect(text).toContain('"finish_reason":"stop"')
    expect(text).toContain('data: [DONE]')
  })
})

describe('wire body', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  function mockSse() {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
  }

  function sentBody(): Record<string, unknown> {
    return JSON.parse(fetchMock.mock.calls[0][1].body)
  }

  it('never sends stream: false to the gateway (it would be rejected)', async () => {
    mockSse()
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
      stream: false,
    })
    expect(sentBody()).not.toHaveProperty('stream')
  })

  it('never sends stream: true to the gateway either', async () => {
    mockSse()
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
      stream: true,
    })
    expect(sentBody()).not.toHaveProperty('stream')
  })

  it('forwards temperature and max_tokens to the gateway', async () => {
    mockSse()
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.4,
      max_tokens: 512,
    })
    expect(sentBody()).toMatchObject({ temperature: 0.4, max_tokens: 512 })
  })

  it('forwards tools, tool_choice and tool-shaped messages verbatim', async () => {
    mockSse()
    const tools = [{ type: 'function', function: { name: 'get_weather', parameters: { type: 'object' } } }]
    const messages = [
      { role: 'user' as const, content: 'weather in SF?' },
      { role: 'assistant' as const, content: null, tool_calls: [{ id: 'call_1', type: 'function' as const, function: { name: 'get_weather', arguments: '{}' } }] },
      { role: 'tool' as const, content: '{"temp": 21}', tool_call_id: 'call_1' },
    ]
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools,
      tool_choice: 'auto',
    })
    expect(sentBody()).toMatchObject({ model: 'gpt-4o', messages, tools, tool_choice: 'auto' })
  })
})

describe('tool calls in responses', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('assembles chunked OpenAI tool_calls into a buffered completion', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"id":"chatcmpl_9","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":""}}]},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl_9","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"city\\":"}}]},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl_9","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"SF\\"}"}}]},"finish_reason":null}]}\n\n' +
      'data: {"id":"chatcmpl_9","object":"chat.completion.chunk","created":1700000000,"model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":20,"completion_tokens":8,"total_tokens":28}}\n\n' +
      'data: [DONE]\n\n'
    ), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'weather in SF?' }],
      tools: [{ type: 'function', function: { name: 'get_weather' } }],
    })

    expect(res).toMatchObject({
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null, // pure tool-call turn
          tool_calls: [{
            id: 'call_abc',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"SF"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    })
  })

  it('normalizes Anthropic tool_use blocks into OpenAI tool_calls', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"type":"message_start","message":{"id":"msg_9","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":15,"output_tokens":0}}}\n\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_xyz","name":"get_weather","input":{}}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":"}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\\"SF\\"}"}}\n\n' +
      'data: {"type":"content_block_stop","index":0}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":12}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    ), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'weather in SF?' }],
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
    })

    expect(res).toMatchObject({
      id: 'chatcmpl_msg_9',
      model: 'claude-sonnet-4-6',
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'toolu_xyz',
            type: 'function',
            function: { name: 'get_weather', arguments: '{"city":"SF"}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
      usage: { prompt_tokens: 15, completion_tokens: 12, total_tokens: 27 },
    })
  })

  it('streams Anthropic tool_use as OpenAI delta.tool_calls chunks', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"type":"message_start","message":{"id":"msg_9","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":15,"output_tokens":0}}}\n\n' +
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_xyz","name":"get_weather","input":{}}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":5}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    ), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const stream = await rouva.chat.completions.create({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'weather in SF?' }],
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      stream: true,
    })

    const text = await readStream(stream as ReadableStream<Uint8Array>)
    expect(text).toContain('"tool_calls"')
    expect(text).toContain('"id":"toolu_xyz"')
    expect(text).toContain('"name":"get_weather"')
    expect(text).toContain('"arguments":"{}"')
    expect(text).toContain('"finish_reason":"tool_calls"')
    expect(text).toContain('data: [DONE]')
  })

  it('mixed text + tool_use keeps both text content and tool_calls', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(
      'data: {"type":"message_start","message":{"id":"msg_9","type":"message","role":"assistant","model":"claude-sonnet-4-6","content":[],"stop_reason":null,"usage":{"input_tokens":15,"output_tokens":0}}}\n\n' +
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Checking the weather."}}\n\n' +
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_2","name":"get_weather","input":{}}}\n\n' +
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n' +
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use","stop_sequence":null},"usage":{"output_tokens":9}}\n\n' +
      'data: {"type":"message_stop"}\n\n'
    ), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))

    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'weather in SF?' }],
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
    })

    expect(res).toMatchObject({
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: 'Checking the weather.',
          tool_calls: [{
            id: 'toolu_2',
            type: 'function',
            function: { name: 'get_weather', arguments: '{}' },
          }],
        },
        finish_reason: 'tool_calls',
      }],
    })
  })
})

describe('sampling params', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('forwards top_p, stop, and seed to the gateway verbatim', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'gpt-4o-mini',
      top_p: 0.9,
      stop: ['END'],
      seed: 42,
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.top_p).toBe(0.9)
    expect(body.stop).toEqual(['END'])
    expect(body.seed).toBe(42)
  })

  describe('session management', () => {
    it('startSession() returns a session ID string', () => {
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      const id = rouva.startSession()
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
    })

    it('sessionId getter returns undefined before startSession()', () => {
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      expect(rouva.sessionId).toBeUndefined()
    })

    it('sessionId getter returns the active session ID after startSession()', () => {
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      const id = rouva.startSession()
      expect(rouva.sessionId).toBe(id)
    })

    it('endSession() clears the session ID', () => {
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      rouva.startSession()
      rouva.endSession()
      expect(rouva.sessionId).toBeUndefined()
    })

    it('sends x-rouva-session-id header when a session is active', async () => {
      fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      const id = rouva.startSession()
      await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
      expect(fetchMock.mock.calls[0][1].headers['x-rouva-session-id']).toBe(id)
    })

    it('does not send x-rouva-session-id header when no session is active', async () => {
      fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-rouva-session-id')
    })

    it('does not send x-rouva-session-id after endSession()', async () => {
      fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      }))
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      rouva.startSession()
      rouva.endSession()
      await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
      expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('x-rouva-session-id')
    })

    it('each startSession() call generates a unique ID', () => {
      const rouva = new Rouva({ apiKey: 'rva_test_key' })
      const id1 = rouva.startSession()
      const id2 = rouva.startSession()
      expect(id1).not.toBe(id2)
    })
  })
})

// ── 0.3.0: contract sync with the gateway (2026-10-11) ────────────────────────

describe('0.3.0 — errors carry the refusal details', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('a marked refusal (X-Rouva-Refusal, sent by the reservation step) throws RouvaError with status, refusal, retryAfter and the message', async () => {
    const { RouvaError } = await import('../src')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Monthly spend limit of $5.00 reached for this key.' }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'X-Rouva-Refusal': 'key_cap', 'Retry-After': '3600' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err).toBeInstanceOf(Error)                       // existing catch blocks keep working
    expect(err.status).toBe(429)
    expect(err.refusal).toBe('key_cap')
    expect(err.retryAfter).toBe(3600)
    expect(err.error).toBe('Monthly spend limit of $5.00 reached for this key.')
    expect(err.message).toMatch(/^\[Rouva\] Gateway error 429: /)   // same format as before
  })

  it('0.3.2: a deadline refusal (504, X-Rouva-Refusal: deadline, Retry-After: 1) — nothing was sent, safe to retry', async () => {
    const { RouvaError } = await import('../src')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'This request ran out of time before OpenAI could be called. Please retry.', provider: 'openai' }), {
      status: 504, headers: { 'Content-Type': 'application/json', 'X-Rouva-Refusal': 'deadline', 'Retry-After': '1' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.status).toBe(504)
    expect(err.refusal).toBe('deadline')
    expect(err.retryAfter).toBe(1)
    expect(err.error).toMatch(/ran out of time/)
  })

  it('an unmarked 429 (early cap check: no X-Rouva-Refusal) still exposes retryAfter and the gateway message', async () => {
    const { RouvaError } = await import('../src')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Monthly workspace spend limit of $50.00 reached.' }), {
      status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '86400' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.refusal).toBeUndefined()
    expect(err.retryAfter).toBe(86400)
    expect(err.error).toMatch(/spend limit/)
  })

  it('a provider error (no refusal header, plain text) still throws RouvaError with the raw body', async () => {
    const { RouvaError } = await import('../src')
    fetchMock.mockResolvedValue(new Response('upstream overloaded', { status: 503 }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.refusal).toBeUndefined()
    expect(err.retryAfter).toBeUndefined()
    expect(err.body).toBe('upstream overloaded')
  })
})

describe('0.3.0 — response metadata', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('X-Rouva-Dedup: 1 surfaces as _rouva.dedup (the semantic-cache field is gone)', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Rouva-Dedup': '1', 'X-Rouva-Model': 'gpt-4o-mini', 'x-rouva-cache': 'hit' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }) as { _rouva?: Record<string, unknown> }
    expect(res._rouva).toEqual({ model_used: 'gpt-4o-mini', provider_used: undefined, task_type: undefined, dedup: true })
    expect(res._rouva).not.toHaveProperty('cache')
  })
})

describe('0.3.0 — new request fields reach the gateway', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('forwards max_completion_tokens and metadata', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      model: 'claude-opus-5-5',
      messages: [{ role: 'user', content: 'hi' }],
      max_completion_tokens: 256,
      metadata: { feature: 'search', team: 'growth' },
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      model: 'claude-opus-5-5', max_completion_tokens: 256, metadata: { feature: 'search', team: 'growth' },
    })
  })
})

describe('0.3.0 — rouva.run()', () => {
  beforeEach(() => { fetchMock.mockReset() })

  const params = {
    model: 'claude-haiku-4-5-20251001',
    messages: [{ role: 'user' as const, content: 'Weather in Paris?' }],
    tools: [{ name: 'get_weather', description: 'Get weather', input_schema: { type: 'object', properties: {} } }],
    tool_handlers: { get_weather: 'https://api.example.com/weather' },
    max_turns: 5,
  }

  it('POSTs to /api/gateway/run with Bearer auth and returns the run result', async () => {
    const result = { content: 'Sunny', turns: 2, tool_calls_made: 1, session_id: 'rva-sess-1', finish_reason: 'stop', session_cost_usd: 0.0012 }
    fetchMock.mockResolvedValue(new Response(JSON.stringify(result), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key', baseURL: 'https://app.rouva.io/' })
    expect(await rouva.run(params)).toEqual(result)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://app.rouva.io/api/gateway/run')
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer rva_test_key')
    expect(JSON.parse(init.body as string)).toEqual(params)
  })

  it('a non-2xx run throws RouvaError whose body keeps the partial turns and cost', async () => {
    const { RouvaError } = await import('../src')
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'Spend accounting failed for this turn', turns: 2, session_id: 'rva-sess-1', session_cost_usd: 0.004 }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'Retry-After': '10' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.run(params).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.message).toMatch(/^\[Rouva\] Run error 503: /)
    expect(err.retryAfter).toBe(10)
    expect(err.body).toMatchObject({ turns: 2, session_cost_usd: 0.004 })
  })
})

describe('0.3.0 — review follow-ups', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('an empty metadata header (X-Rouva-Task on a duplicate-cache hit) is undefined, not ""', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), {
      status: 200, headers: { 'Content-Type': 'text/event-stream', 'X-Rouva-Dedup': '1', 'X-Rouva-Model': 'gpt-4o-mini', 'X-Rouva-Task': '' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }) as { _rouva?: Record<string, unknown> }
    expect(res._rouva?.task_type).toBeUndefined()
    expect(res._rouva?.dedup).toBe(true)
  })

  it('create() and run() pass an AbortSignal through to fetch', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const ac = new AbortController()
    await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }, { signal: ac.signal })
    expect(fetchMock.mock.calls[0][1].signal).toBe(ac.signal)
    fetchMock.mockResolvedValue(new Response('{}', { status: 200 }))
    await rouva.run({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }], tools: [{}], tool_handlers: {} }, { signal: ac.signal })
    expect(fetchMock.mock.calls[1][1].signal).toBe(ac.signal)
  })

  it('the session header still rides on chat requests through the shared request path', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const id = rouva.startSession()
    await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })
    expect(fetchMock.mock.calls[0][1].headers['x-rouva-session-id']).toBe(id)
  })
})

describe('0.3.0 — a body that fails mid-response is an error, never a truncated success (Codex P1)', () => {
  beforeEach(() => { fetchMock.mockReset() })

  function failingBody(): ReadableStream<Uint8Array> {
    let sent = false
    return new ReadableStream({
      pull(controller) {
        if (!sent) {
          sent = true
          controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n'))
          return
        }
        controller.error(new DOMException('The operation was aborted.', 'AbortError'))
      },
    })
  }

  it('buffered: create() rejects instead of resolving with partial content', async () => {
    fetchMock.mockResolvedValue(new Response(failingBody(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await expect(rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrow(/aborted/)
  })

  it('streaming: the consumer sees the error, not a normal end', async () => {
    fetchMock.mockResolvedValue(new Response(failingBody(), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const stream = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }], stream: true }) as ReadableStream<Uint8Array>
    await expect(readStream(stream)).rejects.toThrow(/aborted/)
  })
})

describe('0.3.0 — an abort while reading an error body stays an abort (Codex P2)', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('rejects with the AbortError, not a RouvaError', async () => {
    const { RouvaError } = await import('../src')
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.error(new DOMException('The operation was aborted.', 'AbortError')) },
    })
    fetchMock.mockResolvedValue(new Response(body, { status: 429, headers: { 'Retry-After': '60' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(err).not.toBeInstanceOf(RouvaError)
    expect(err.name).toBe('AbortError')
  })

  it('other body-read failures still fall back to a RouvaError with the status text', async () => {
    const { RouvaError } = await import('../src')
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new TypeError('network reset')) } })
    fetchMock.mockResolvedValue(new Response(body, { status: 502, statusText: 'Bad Gateway' }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages: [{ role: 'user', content: 'hi' }] }).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.status).toBe(502)
  })
})
