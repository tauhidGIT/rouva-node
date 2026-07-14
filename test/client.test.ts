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
})
