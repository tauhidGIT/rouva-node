import type {
  RouvaOptions,
  ChatCompletionParams,
  ChatCompletion,
} from './types'
import {
  getRouvaMetadata,
  normalizeGatewayStream,
  readChatCompletionFromSse,
} from './sse'

const DEFAULT_BASE_URL = 'https://app.rouva.io'

export class Rouva {
  private apiKey: string
  private baseURL: string
  private _sessionId: string | undefined

  readonly chat: {
    completions: {
      create(params: ChatCompletionParams): Promise<ChatCompletion | ReadableStream>
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
        create: (params: ChatCompletionParams) => this._createChatCompletion(params),
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

  private async _createChatCompletion(
    params: ChatCompletionParams
  ): Promise<ChatCompletion | ReadableStream> {
    const url = `${this.baseURL}/api/gateway/messages`

    // `stream` is a client-side toggle (return the raw stream vs a buffered
    // completion) and never reaches the wire: the SDK always requests SSE
    // and normalizes it, keeping a single parsing path for both modes and
    // every provider dialect. (The gateway itself now supports stream: false
    // — used by OpenAI-compatible clients on /v1 — but the SDK's buffered
    // mode still consumes the stream.)
    const { stream: _stream, ...body } = params

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    }
    if (this._sessionId) headers['x-rouva-session-id'] = this._sessionId

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => res.statusText)
      throw new Error(`[Rouva] Gateway error ${res.status}: ${body}`)
    }

    if (!res.body) throw new Error('[Rouva] No response body from gateway')

    const normalizedStream = normalizeGatewayStream(res.body)

    if (params.stream) return normalizedStream

    return readChatCompletionFromSse(normalizedStream, getRouvaMetadata(res.headers))
  }
}
