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
