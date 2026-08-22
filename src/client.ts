import type {
  RouvaOptions,
  ChatCompletionParams,
  ChatCompletion,
  ToolHandler,
  RunLoopOptions,
  RunLoopResult,
  FunctionToolCall,
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
  private _toolHandlers: Map<string, ToolHandler> = new Map()

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

  /**
   * Register a handler for a named tool. When `runLoop()` receives a
   * tool_calls response from the model containing this tool name, the handler
   * is called with the parsed arguments and its return value is sent back as
   * the tool result.
   */
  registerTool(name: string, handler: ToolHandler): void {
    this._toolHandlers.set(name, handler)
  }

  /**
   * Run a full agentic loop: send messages to the model, dispatch any tool
   * calls in parallel, feed results back, and repeat until the model returns
   * a final text response or `maxTurns` is reached.
   *
   * A session is automatically started before the first turn and ended when
   * the loop completes, so all turns appear grouped in the Rouva dashboard.
   */
  async runLoop(options: RunLoopOptions): Promise<RunLoopResult> {
    const {
      messages,
      tools,
      model,
      provider,
      maxTurns = 10,
      max_tokens,
      temperature,
    } = options

    const sessionId = this.startSession()
    const conversation = [...messages]
    let turns = 0
    let toolCallsMade = 0

    try {
      while (turns < maxTurns) {
        const completion = await this.chat.completions.create({
          messages: conversation,
          tools,
          model,
          provider,
          max_tokens,
          temperature,
          stream: false,
        }) as import('./types').ChatCompletion

        turns++
        const choice = completion.choices[0]
        if (!choice) throw new Error('[Rouva] runLoop: empty choices in response')

        const { finish_reason, message } = choice

        // Always append the assistant turn to the conversation
        conversation.push(message)

        if (finish_reason === 'stop' || !message.tool_calls?.length) {
          return {
            content: message.content ?? '',
            turns,
            toolCallsMade,
            sessionId,
          }
        }

        // Dispatch all tool calls in parallel
        const toolCalls: FunctionToolCall[] = message.tool_calls
        const results = await Promise.all(
          toolCalls.map(async (tc) => {
            const handler = this._toolHandlers.get(tc.function.name)
            if (!handler) {
              throw new Error(
                `[Rouva] runLoop: no handler registered for tool "${tc.function.name}". ` +
                `Call client.registerTool("${tc.function.name}", handler) before runLoop().`
              )
            }
            let args: Record<string, unknown>
            try {
              args = JSON.parse(tc.function.arguments)
            } catch {
              args = {}
            }
            const result = await handler(args)
            return {
              role: 'tool' as const,
              tool_call_id: tc.id,
              content: typeof result === 'string' ? result : JSON.stringify(result),
            }
          })
        )

        toolCallsMade += toolCalls.length
        conversation.push(...results)
      }

      throw new Error(
        `[Rouva] runLoop: reached maxTurns (${maxTurns}) without a final response. ` +
        `Increase maxTurns or check for infinite tool call loops.`
      )
    } finally {
      this.endSession()
    }
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
