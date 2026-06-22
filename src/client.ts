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

  private async _createChatCompletion(
    params: ChatCompletionParams
  ): Promise<ChatCompletion | ReadableStream> {
    const url = `${this.baseURL}/api/gateway/messages`

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(params),
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
