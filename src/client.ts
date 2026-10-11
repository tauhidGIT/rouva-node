import type {
  RouvaOptions,
  ChatCompletionParams,
  ChatCompletion,
  RunParams,
  RunResult,
  RequestOptions,
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
      create(params: ChatCompletionParams, options?: RequestOptions): Promise<ChatCompletion | ReadableStream>
    }
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

  // One request path for every endpoint: auth, JSON body, optional abort signal.
  private _post(path: string, body: unknown, extraHeaders: Record<string, string>, options?: RequestOptions): Promise<Response> {
    return fetch(`${this.baseURL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        ...extraHeaders,
      },
      body: JSON.stringify(body),
      ...(options?.signal ? { signal: options.signal } : {}),
    })
  }

  private async _createChatCompletion(
    params: ChatCompletionParams,
    options?: RequestOptions
  ): Promise<ChatCompletion | ReadableStream> {
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

    const normalizedStream = normalizeGatewayStream(res.body)

    if (params.stream) return normalizedStream

    return readChatCompletionFromSse(normalizedStream, getRouvaMetadata(res.headers))
  }
}
