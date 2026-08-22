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

// ── Helpers for runLoop tests ─────────────────────────────────────────────────
// These emit proper SSE streaming delta format — readChatCompletionFromSse
// parses `delta` fields, not `message` fields.

function sseStream(...chunks: object[]): Response {
  const lines = chunks.map(c => `data: ${JSON.stringify(c)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(streamFrom(lines), {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

function toolCallCompletion(toolCalls: { id: string; name: string; arguments: string }[]): Response {
  // Emit: role delta, then one chunk per tool call (name+id), then finish_reason chunk
  return sseStream(
    {
      id: 'chatcmpl-tools',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
    },
    ...toolCalls.map((tc, i) => ({
      id: 'chatcmpl-tools',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{
        index: 0,
        delta: {
          tool_calls: [{ index: i, id: tc.id, type: 'function', function: { name: tc.name, arguments: tc.arguments } }],
        },
        finish_reason: null,
      }],
    })),
    {
      id: 'chatcmpl-tools',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 },
    },
  )
}

function textCompletion(content: string): Response {
  return sseStream(
    {
      id: 'chatcmpl-final',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: { role: 'assistant', content }, finish_reason: null }],
    },
    {
      id: 'chatcmpl-final',
      object: 'chat.completion.chunk',
      created: 1,
      model: 'gpt-4o',
      choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
      usage: { prompt_tokens: 30, completion_tokens: 15, total_tokens: 45 },
    },
  )
}

const TOOLS = [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: {} } }]

beforeEach(() => { fetchMock.mockReset() })

// ── registerTool ──────────────────────────────────────────────────────────────

describe('registerTool', () => {
  it('registers a handler that runLoop can call', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const handler = vi.fn().mockResolvedValue({ temp: 72 })
    rouva.registerTool('get_weather', handler)

    fetchMock
      .mockResolvedValueOnce(toolCallCompletion([{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }]))
      .mockResolvedValueOnce(textCompletion('It is 72 degrees.'))

    await rouva.runLoop({
      messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith({ city: 'Paris' })
  })

  it('overwrites a previously registered handler with the same name', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const first = vi.fn().mockResolvedValue('first')
    const second = vi.fn().mockResolvedValue('second')
    rouva.registerTool('fn', first)
    rouva.registerTool('fn', second)

    fetchMock
      .mockResolvedValueOnce(toolCallCompletion([{ id: 'call_1', name: 'fn', arguments: '{}' }]))
      .mockResolvedValueOnce(textCompletion('done'))

    await rouva.runLoop({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS, model: 'gpt-4o' })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledOnce()
  })
})

// ── runLoop — basic flow ──────────────────────────────────────────────────────

describe('runLoop — basic flow', () => {
  it('returns final content when model stops immediately (no tool calls)', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    fetchMock.mockResolvedValueOnce(textCompletion('Hello!'))

    const result = await rouva.runLoop({
      messages: [{ role: 'user', content: 'Say hello' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })

    expect(result.content).toBe('Hello!')
    expect(result.turns).toBe(1)
    expect(result.toolCallsMade).toBe(0)
  })

  it('completes a single-tool single-turn loop', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    rouva.registerTool('get_weather', async () => ({ temp: 72 }))

    fetchMock
      .mockResolvedValueOnce(toolCallCompletion([{ id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' }]))
      .mockResolvedValueOnce(textCompletion('72 degrees in Paris.'))

    const result = await rouva.runLoop({
      messages: [{ role: 'user', content: 'Weather in Paris?' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })

    expect(result.content).toBe('72 degrees in Paris.')
    expect(result.turns).toBe(2)
    expect(result.toolCallsMade).toBe(1)
  })

  it('returns a sessionId', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    fetchMock.mockResolvedValueOnce(textCompletion('Done'))

    const result = await rouva.runLoop({
      messages: [{ role: 'user', content: 'hi' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })

    expect(result.sessionId).toMatch(/^rva-sess-/)
  })

  it('clears the session after loop completes', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    fetchMock.mockResolvedValueOnce(textCompletion('Done'))

    await rouva.runLoop({ messages: [{ role: 'user', content: 'hi' }], tools: TOOLS, model: 'gpt-4o' })

    expect(rouva.sessionId).toBeUndefined()
  })

  it('clears the session even when an error is thrown', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    rouva.registerTool('get_weather', async () => { throw new Error('tool failed') })

    fetchMock.mockResolvedValueOnce(
      toolCallCompletion([{ id: 'call_1', name: 'get_weather', arguments: '{}' }])
    )

    await expect(rouva.runLoop({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS, model: 'gpt-4o' })).rejects.toThrow('tool failed')
    expect(rouva.sessionId).toBeUndefined()
  })
})

// ── runLoop — parallel dispatch ───────────────────────────────────────────────

describe('runLoop — parallel dispatch', () => {
  it('dispatches two tool calls in parallel and sends both results in one turn', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const order: string[] = []

    rouva.registerTool('get_weather', async (args) => {
      order.push(`weather:${(args as { city: string }).city}`)
      return { temp: 20 }
    })
    rouva.registerTool('search_web', async (args) => {
      order.push(`search:${(args as { query: string }).query}`)
      return { results: [] }
    })

    fetchMock
      .mockResolvedValueOnce(toolCallCompletion([
        { id: 'call_1', name: 'get_weather', arguments: '{"city":"Paris"}' },
        { id: 'call_2', name: 'search_web', arguments: '{"query":"Eiffel Tower"}' },
      ]))
      .mockResolvedValueOnce(textCompletion('Here is the info.'))

    const result = await rouva.runLoop({
      messages: [{ role: 'user', content: 'Weather and web search' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })

    expect(result.toolCallsMade).toBe(2)
    expect(result.turns).toBe(2)
    // Both handlers called
    expect(order).toHaveLength(2)
    expect(order).toContain('weather:Paris')
    expect(order).toContain('search:Eiffel Tower')
  })

  it('sends tool results as separate tool messages with correct tool_call_ids', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    rouva.registerTool('fn_a', async () => 'result_a')
    rouva.registerTool('fn_b', async () => 'result_b')

    // Both tool calls in a single delta chunk so the SSE parser sees them together
    fetchMock
      .mockResolvedValueOnce(sseStream(
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [
          { index: 0, id: 'call_a', type: 'function', function: { name: 'fn_a', arguments: '{}' } },
          { index: 1, id: 'call_b', type: 'function', function: { name: 'fn_b', arguments: '{}' } },
        ] }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 20, completion_tokens: 10, total_tokens: 30 } },
      ))
      .mockResolvedValueOnce(textCompletion('done'))

    await rouva.runLoop({
      messages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMessages = secondBody.messages.filter((m: { role: string }) => m.role === 'tool')
    expect(toolMessages).toHaveLength(2)
    expect(toolMessages.find((m: { tool_call_id: string }) => m.tool_call_id === 'call_a').content).toBe('result_a')
    expect(toolMessages.find((m: { tool_call_id: string }) => m.tool_call_id === 'call_b').content).toBe('result_b')
  })

  it('JSON-serializes non-string tool results', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    rouva.registerTool('get_data', async () => ({ value: 42, items: [1, 2, 3] }))

    fetchMock
      .mockResolvedValueOnce(sseStream(
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'get_data', arguments: '{}' } }] }, finish_reason: null }] },
        { id: 'c', object: 'chat.completion.chunk', created: 1, model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } },
      ))
      .mockResolvedValueOnce(textCompletion('done'))

    await rouva.runLoop({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS, model: 'gpt-4o' })

    const secondBody = JSON.parse(fetchMock.mock.calls[1][1].body)
    const toolMsg = secondBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(JSON.parse(toolMsg.content)).toEqual({ value: 42, items: [1, 2, 3] })
  })

  it('accumulates toolCallsMade across multiple turns', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    rouva.registerTool('step', async () => 'ok')

    fetchMock
      .mockResolvedValueOnce(toolCallCompletion([{ id: 'c1', name: 'step', arguments: '{}' }]))
      .mockResolvedValueOnce(toolCallCompletion([{ id: 'c2', name: 'step', arguments: '{}' }, { id: 'c3', name: 'step', arguments: '{}' }]))
      .mockResolvedValueOnce(textCompletion('done'))

    const result = await rouva.runLoop({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS, model: 'gpt-4o' })

    expect(result.toolCallsMade).toBe(3)
    expect(result.turns).toBe(3)
  })
})

// ── runLoop — error handling ──────────────────────────────────────────────────

describe('runLoop — error handling', () => {
  it('throws when no handler is registered for a tool', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })

    fetchMock.mockResolvedValueOnce(
      toolCallCompletion([{ id: 'call_1', name: 'unknown_tool', arguments: '{}' }])
    )

    await expect(rouva.runLoop({
      messages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
      model: 'gpt-4o',
    })).rejects.toThrow('no handler registered for tool "unknown_tool"')
  })

  it('throws when maxTurns is exceeded', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    rouva.registerTool('loop_forever', async () => 'ok')

    // Each call must return a fresh Response — a consumed ReadableStream can't be re-read
    fetchMock.mockImplementation(() =>
      Promise.resolve(toolCallCompletion([{ id: 'call_1', name: 'loop_forever', arguments: '{}' }]))
    )

    await expect(rouva.runLoop({
      messages: [{ role: 'user', content: 'go' }],
      tools: TOOLS,
      model: 'gpt-4o',
      maxTurns: 3,
    })).rejects.toThrow('reached maxTurns (3)')
  })

  it('handles malformed tool arguments gracefully (defaults to empty object)', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const handler = vi.fn().mockResolvedValue('ok')
    rouva.registerTool('get_weather', handler)

    fetchMock
      .mockResolvedValueOnce(toolCallCompletion([{ id: 'call_1', name: 'get_weather', arguments: 'not-json' }]))
      .mockResolvedValueOnce(textCompletion('done'))

    await rouva.runLoop({ messages: [{ role: 'user', content: 'go' }], tools: TOOLS, model: 'gpt-4o' })

    expect(handler).toHaveBeenCalledWith({})
  })
})
