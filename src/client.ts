import type {
  RouvaOptions,
  ChatCompletionParams,
  ChatCompletion,
  RunParams,
  RunResult,
  RequestOptions,
  RouvaRequest,
  RouvaStream,
  RouvaExplainResult,
  ExplainOptions,
} from './types'
import {
  getRouvaMetadata,
  normalizeGatewayStream,
  readChatCompletionFromSse,
} from './sse'
import { toRouvaError } from './errors'

const DEFAULT_BASE_URL = 'https://app.rouva.io'

export class Rouva {
  private apiKey: string
  private baseURL: string
  private _sessionId: string | undefined

  readonly chat: {
    completions: {
      create(params: ChatCompletionParams, options?: RequestOptions): Promise<ChatCompletion | RouvaStream>
    }
  }

  readonly requests: {
    /**
     * Read one request from your request log (`GET /api/gateway/requests/{id}`)
     * by the id a response carried (`_rouva.request_id`, header
     * `X-Rouva-Request-Id`): its model, routing reason, tokens, cost, savings and
     * quality score. A key reads only its own requests (another's id is a 404).
     *
     * A stream's cost is recorded just after its last chunk, and the quality
     * score once the judge has run (a few seconds), so check `status`:
     * `pending` → not settled yet, retry shortly; `incomplete` → settled from
     * partial usage; `settled` → cost final; `scored` → cost final and scored.
     * Throws `RouvaError` on a non-2xx response (a 503 carries `retryAfter`).
     *
     * @example
     * const stream = await rouva.chat.completions.create({ messages, stream: true }) as RouvaStream
     * // ...consume the stream...
     * const req = await rouva.requests.get(stream._rouva!.request_id!)
     * console.log(req.status, req.cost_usd, req.saved_usd)
     */
    get(id: string, options?: RequestOptions): Promise<RouvaRequest>
  }

  constructor(options: RouvaOptions) {
    if (!options.apiKey) throw new Error('[Rouva] apiKey is required')
    if (!options.apiKey.startsWith('rva_')) {
      throw new Error('[Rouva] apiKey must start with rva_')
    }

    this.apiKey = options.apiKey
    this.baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/$/, '')

    this.chat = {
      completions: {
        create: (params: ChatCompletionParams, options?: RequestOptions) => this._createChatCompletion(params, options),
      },
    }

    this.requests = {
      get: (id: string, options?: RequestOptions) => this._getRequest(id, options),
    }
  }

  /**
   * Start a new agent session. Every subsequent `chat.completions.create()`
   * call will include `x-rouva-session-id` so all turns are grouped in the
   * Rouva dashboard. Call `endSession()` when the agent run is complete.
   * Returns the generated session ID.
   */
  startSession(): string {
    this._sessionId = `rva-sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    return this._sessionId
  }

  /**
   * End the current session. Subsequent requests will not carry a session ID
   * until `startSession()` is called again.
   */
  endSession(): void {
    this._sessionId = undefined
  }

  /** The active session ID, or undefined if no session is in progress. */
  get sessionId(): string | undefined {
    return this._sessionId
  }

  /**
   * Run a server-side agentic loop (`POST /api/gateway/run`). The gateway
   * calls the model, POSTs each tool call to its handler URL as
   * `{ name, arguments }` (in parallel), feeds the response bodies back as tool
   * results, and loops until the model stops or a limit is reached — no
   * streaming, no client-side loop required. Throws `RouvaError` on a non-2xx
   * response; once the loop has started, its `body` also carries the partial
   * `turns`, `session_id` and `session_cost_usd` (errors before the first turn
   * — validation, no key, allowlist — carry only `error`). Pass
   * `{ signal }` to cancel; a run can take several minutes.
   *
   * Every turn is logged as a usage snapshot grouped by `session_id` in the
   * Rouva dashboard, giving you a full session replay with per-turn cost,
   * model, and tool call details.
   *
   * @example
   * const result = await rouva.run({
   *   model: 'claude-haiku-4-5-20251001',
   *   messages: [{ role: 'user', content: 'What is the weather in Paris?' }],
   *   tools: [{ name: 'get_weather', description: '...', input_schema: { ... } }],
   *   tool_handlers: { get_weather: 'https://api.example.com/weather' },
   *   max_turns: 5,
   * })
   * console.log(result.content)      // final model response
   * console.log(result.turns)        // how many turns it took
   * console.log(result.session_id)   // dashboard session ID
   */
  async run(params: RunParams, options?: RequestOptions): Promise<RunResult> {
    const res = await this._post('/api/gateway/run', params, {}, options)
    if (!res.ok) throw await toRouvaError('Run', res)
    return res.json() as Promise<RunResult>
  }

  private async _getRequest(id: string, options?: RequestOptions): Promise<RouvaRequest> {
    if (typeof id !== 'string' || !id) throw new Error('[Rouva] request id is required')
    const res = await this._fetch('GET', `/api/gateway/requests/${encodeURIComponent(id)}`, undefined, {}, options)
    if (!res.ok) throw await toRouvaError('Request', res)
    return res.json() as Promise<RouvaRequest>
  }

  private _post(path: string, body: unknown, extraHeaders: Record<string, string>, options?: RequestOptions): Promise<Response> {
    return this._fetch('POST', path, body, extraHeaders, options)
  }

  /**
   * Dry run (`POST /api/gateway/explain`): what Rouva would do with this
   * request — the model and provider it would pick, why (`route_reason`), how
   * the prompt was classified, and the most it could cost (`max_cost_usd`) —
   * without calling a provider, recording a request or reserving spend. Takes
   * the same params as `chat.completions.create()` (`stream` is ignored, as
   * there). When the real request would be refused, resolves with
   * `would_send: false` and the status and error it would get. Throws
   * `RouvaError` for a bad key or the explain rate limit (429, `refusal: 'rate'`).
   *
   * The prompt is classified as for a real request. Not covered: the
   * duplicate-request cache, a spend cap's remaining budget, provider errors.
   *
   * @example
   * const e = await rouva.explain({ model: 'gpt-6-sol', messages })
   * if (e.would_send) console.log(e.model, e.route_reason, e.max_cost_usd)
   * else console.log(e.status, e.error)
   */
  async explain(params: ChatCompletionParams, options?: ExplainOptions): Promise<RouvaExplainResult> {
    const { stream: _stream, ...body } = params
    const query = options?.endpoint === 'v1' ? '?endpoint=v1' : ''
    const res = await this._post(`/api/gateway/explain${query}`, body, {}, options)
    if (!res.ok) throw await toRouvaError('Explain', res)
    return res.json() as Promise<RouvaExplainResult>
  }

  // One request path for every endpoint: auth, JSON body, optional abort signal.
  private _fetch(
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    extraHeaders: Record<string, string>,
    options?: RequestOptions,
  ): Promise<Response> {
    return fetch(`${this.baseURL}${path}`, {
      method,
      headers: {
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        'Authorization': `Bearer ${this.apiKey}`,
        ...extraHeaders,
      },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  private async _createChatCompletion(
    params: ChatCompletionParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | RouvaStream> {
    // `stream` is a client-side toggle (return the raw stream vs a buffered
    // completion) and never reaches the wire: the SDK always requests SSE
    // and normalizes it, keeping a single parsing path for both modes and
    // every provider dialect. (The gateway itself now supports stream: false
    // — used by OpenAI-compatible clients on /v1 — but the SDK's buffered
    // mode still consumes the stream.)
    const { stream: _stream, ...body } = params

    const sessionHeader: Record<string, string> = this._sessionId ? { 'x-rouva-session-id': this._sessionId } : {}
    const res = await this._post('/api/gateway/messages', body, sessionHeader, options)

    if (!res.ok) throw await toRouvaError('Gateway', res)

    if (!res.body) throw new Error('[Rouva] No response body from gateway')

    const normalizedStream: RouvaStream = normalizeGatewayStream(res.body)
    const metadata = getRouvaMetadata(res.headers)

    if (params.stream) {
      // The headers arrive before the first chunk, so a stream carries the
      // routing decision (and request_id, for its cost) like a completion.
      if (metadata) normalizedStream._rouva = metadata
      return normalizedStream
    }

    return readChatCompletionFromSse(normalizedStream, metadata)
  }
}
