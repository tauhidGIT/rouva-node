import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Rouva, RouvaError } from '../src'
import type { ChatCompletion, RouvaStream } from '../src'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const REQUEST_ID = '7c0e8f2a-1b3c-4d5e-8f90-a1b2c3d4e5f6'
const SSE = 'data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n\n'

function streamFrom(text: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  })
}

// What the gateway's forwarder sends on a streamed success (lib/routing-headers.ts).
const ROUTED = {
  'Content-Type': 'text/event-stream',
  'X-Rouva-Model': 'gpt-6-luna',
  'X-Rouva-Provider': 'openai',
  'X-Rouva-Task-Type': 'simple_qa',
  'X-Rouva-Task': 'simple_qa',
  'X-Rouva-Route-Reason': 'intelligent',
  'X-Rouva-Requested-Model': 'gpt-6-sol',
  'X-Rouva-Request-Id': REQUEST_ID,
  'X-Rouva-Row-Id': REQUEST_ID,
}

const messages = [{ role: 'user' as const, content: 'hi' }]

describe('0.4.0 — routing headers on _rouva', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('a buffered completion carries the whole routing decision', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), { status: 200, headers: ROUTED }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({ messages }) as ChatCompletion
    expect(res._rouva).toStrictEqual({
      request_id: REQUEST_ID,
      model_used: 'gpt-6-luna',
      provider_used: 'openai',
      requested_model: 'gpt-6-sol',
      task_type: 'simple_qa',
      route_reason: 'intelligent',
    })
  })

  it('a stream carries it too, before the first chunk is read', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), { status: 200, headers: ROUTED }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const stream = await rouva.chat.completions.create({ messages, stream: true }) as RouvaStream
    expect(stream._rouva?.request_id).toBe(REQUEST_ID)
    expect(stream._rouva?.route_reason).toBe('intelligent')
    // Still a plain readable stream.
    const reader = stream.getReader()
    expect((await reader.read()).done).toBe(false)
  })

  it('a stream without any Rouva header has no _rouva', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const stream = await rouva.chat.completions.create({ messages, stream: true }) as RouvaStream
    expect(stream._rouva).toBeUndefined()
  })

  it('falls back to the older header names (X-Rouva-Task, X-Rouva-Row-Id)', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream', 'X-Rouva-Model': 'gpt-6-luna', 'X-Rouva-Task': 'code', 'X-Rouva-Row-Id': REQUEST_ID },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({ messages }) as ChatCompletion
    expect(res._rouva).toStrictEqual({ request_id: REQUEST_ID, model_used: 'gpt-6-luna', task_type: 'code' })
  })

  it('cost headers become numbers; an unparseable one is dropped', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), {
      status: 200,
      headers: { ...ROUTED, 'X-Rouva-Cost-Usd': '0.000412', 'X-Rouva-Saved-Usd': '-0.000100' },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({ messages }) as ChatCompletion
    expect(res._rouva?.cost_usd).toBe(0.000412)
    expect(res._rouva?.saved_usd).toBe(-0.0001)

    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), {
      status: 200,
      headers: { ...ROUTED, 'X-Rouva-Cost-Usd': 'n/a', 'X-Rouva-Saved-Usd': '' },
    }))
    const res2 = await rouva.chat.completions.create({ messages }) as ChatCompletion
    expect(res2._rouva).not.toHaveProperty('cost_usd')
    expect(res2._rouva).not.toHaveProperty('saved_usd')
  })

  it('a dedup replay: empty task type and no request id are left out', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom(SSE), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream', 'X-Rouva-Dedup': '1', 'X-Rouva-Model': 'gpt-6-luna', 'X-Rouva-Provider': 'openai',
        'X-Rouva-Task-Type': '', 'X-Rouva-Task': '', 'X-Rouva-Route-Reason': 'dedup', 'X-Rouva-Cost-Usd': '0.000000', 'X-Rouva-Saved-Usd': '0.000000',
      },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const res = await rouva.chat.completions.create({ messages }) as ChatCompletion
    expect(res._rouva).toStrictEqual({
      model_used: 'gpt-6-luna', provider_used: 'openai', route_reason: 'dedup', cost_usd: 0, saved_usd: 0, dedup: true,
    })
  })
})

describe('0.4.0 — RouvaError.requestId', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('is set from X-Rouva-Request-Id on an error the forwarder returned', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'upstream overloaded' }), {
      status: 503, headers: { 'Content-Type': 'application/json', 'X-Rouva-Request-Id': REQUEST_ID },
    }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages }).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.requestId).toBe(REQUEST_ID)
  })

  it('is absent on an error returned before the request was recorded', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'bad' }), { status: 400 }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.chat.completions.create({ messages }).catch((e) => e)
    expect(err.requestId).toBeUndefined()
  })
})

describe('0.4.0 — rouva.requests.get(id)', () => {
  beforeEach(() => { fetchMock.mockReset() })

  const body = {
    id: REQUEST_ID, created_at: '2026-10-21T10:00:00.000Z', status: 'settled', provider: 'openai', model: 'gpt-6-luna',
    requested_model: 'gpt-6-sol', task_type: 'simple_qa', route_reason: 'intelligent', input_tokens: 12, output_tokens: 40,
    cost_usd: 0.000412, saved_usd: 0.0021, quality_score: null, judge_status: null, finish_reason: 'stop', session_id: null,
    dashboard_url: `https://app.rouva.io/dashboard?request=${REQUEST_ID}#request-log`,
  }

  it('GETs /api/gateway/requests/{id} with the key and no body', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key', baseURL: 'https://example.test/' })
    expect(await rouva.requests.get(REQUEST_ID)).toEqual(body)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`https://example.test/api/gateway/requests/${REQUEST_ID}`)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer rva_test_key')
    expect(init.headers).not.toHaveProperty('Content-Type')
  })

  it('encodes the id into the path', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'x' }), { status: 400 }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.requests.get('../keys?x=1').catch(() => {})
    expect(fetchMock.mock.calls[0][0]).toBe('https://app.rouva.io/api/gateway/requests/..%2Fkeys%3Fx%3D1')
  })

  it('a 404 throws RouvaError with the gateway message', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'No request with that id for this key' }), { status: 404 }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.requests.get(REQUEST_ID).catch((e) => e)
    expect(err).toBeInstanceOf(RouvaError)
    expect(err.status).toBe(404)
    expect(err.error).toBe('No request with that id for this key')
    expect(err.message).toMatch(/^\[Rouva\] Request error 404/)
  })

  it('a 503 carries retryAfter', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'retry' }), { status: 503, headers: { 'Retry-After': '5' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const err = await rouva.requests.get(REQUEST_ID).catch((e) => e)
    expect(err.retryAfter).toBe(5)
  })

  it('an empty id throws before any request', async () => {
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await expect(rouva.requests.get('')).rejects.toThrow('request id is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('passes an abort signal through', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const controller = new AbortController()
    await rouva.requests.get(REQUEST_ID, { signal: controller.signal })
    expect(fetchMock.mock.calls[0][1].signal).toBe(controller.signal)
  })
})

describe('0.4.0 — response_format reaches the gateway', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('forwards a json_schema format verbatim', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    const response_format = {
      type: 'json_schema' as const,
      json_schema: { name: 'city', strict: true, schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false } },
    }
    await rouva.chat.completions.create({ messages, response_format })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).response_format).toEqual(response_format)
  })
})

describe('0.4.1 — reasoning_effort and parallel_tool_calls reach the gateway', () => {
  beforeEach(() => { fetchMock.mockReset() })

  it('forwards both verbatim', async () => {
    fetchMock.mockResolvedValue(new Response(streamFrom('data: [DONE]\n\n'), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }))
    const rouva = new Rouva({ apiKey: 'rva_test_key' })
    await rouva.chat.completions.create({
      model: 'gpt-6-luna',
      messages,
      tools: [{ type: 'function', function: { name: 'get_time', parameters: { type: 'object', properties: {} } } }],
      reasoning_effort: 'none',
      parallel_tool_calls: false,
    })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ reasoning_effort: 'none', parallel_tool_calls: false })
  })
})
