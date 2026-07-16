import type {
  ChatCompletion,
  ChatCompletionUsage,
  FunctionToolCall,
  RouvaResponseMeta,
} from './types'

interface ParsedSseEvent {
  raw: string
  data: string
  json: unknown | null
}

interface NormalizationState {
  provider: 'openai' | 'anthropic' | null
  id: string
  model: string
  created: number
  promptTokens: number
  completionTokens: number
  roleEmitted: boolean
  finalChunkEmitted: boolean
  /** Anthropic content_block index → OpenAI tool_calls index */
  toolCallIndexByBlock: Record<number, number>
  nextToolCallIndex: number
}

function parseSseEvent(line: string): ParsedSseEvent | null {
  const raw = line.trim()
  if (!raw.startsWith('data:')) return null

  const data = raw.slice(5).trim()
  if (!data) return null

  try {
    return { raw, data, json: data === '[DONE]' ? null : JSON.parse(data) }
  } catch {
    return { raw, data, json: null }
  }
}

function stringifySse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`
}

function detectProvider(payload: unknown): 'openai' | 'anthropic' | null {
  if (!payload || typeof payload !== 'object') return null
  if ('choices' in payload || 'usage' in payload) return 'openai'
  if ('type' in payload) return 'anthropic'
  return null
}

function normalizeChatId(id: string): string {
  return id.startsWith('chatcmpl_') ? id : `chatcmpl_${id}`
}

function toFinishReason(stopReason: string | null | undefined): string | null {
  if (!stopReason) return null
  if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'stop'
  if (stopReason === 'max_tokens') return 'length'
  if (stopReason === 'tool_use') return 'tool_calls'
  return stopReason
}

function initialState(): NormalizationState {
  return {
    provider: null,
    id: `chatcmpl_${Date.now()}`,
    model: 'unknown',
    created: Math.floor(Date.now() / 1000),
    promptTokens: 0,
    completionTokens: 0,
    roleEmitted: false,
    finalChunkEmitted: false,
    toolCallIndexByBlock: {},
    nextToolCallIndex: 0,
  }
}

function normalizeAnthropicPayload(
  payload: Record<string, unknown>,
  state: NormalizationState,
): string[] {
  const eventType = typeof payload.type === 'string' ? payload.type : null
  const chunks: string[] = []

  if (eventType === 'message_start') {
    const message = (payload.message ?? {}) as Record<string, unknown>
    const usage = (message.usage ?? {}) as Record<string, unknown>
    state.id = normalizeChatId(typeof message.id === 'string' ? message.id : state.id)
    state.model = typeof message.model === 'string' ? message.model : state.model
    state.promptTokens = typeof usage.input_tokens === 'number' ? usage.input_tokens : 0

    if (!state.roleEmitted) {
      chunks.push(stringifySse({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
      }))
      state.roleEmitted = true
    }
  }

  // Anthropic announces each tool call in a content_block_start, then streams
  // its arguments as input_json_delta fragments. Re-emit both as OpenAI
  // delta.tool_calls chunks so callers see one dialect regardless of provider.
  if (eventType === 'content_block_start') {
    const block = (payload.content_block ?? {}) as Record<string, unknown>
    const blockIndex = typeof payload.index === 'number' ? payload.index : null
    if (block.type === 'tool_use' && blockIndex !== null) {
      const toolCallIndex = state.nextToolCallIndex++
      state.toolCallIndexByBlock[blockIndex] = toolCallIndex

      if (!state.roleEmitted) {
        chunks.push(stringifySse({
          id: state.id,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }))
        state.roleEmitted = true
      }

      chunks.push(stringifySse({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: toolCallIndex,
              id: typeof block.id === 'string' ? block.id : `call_${toolCallIndex}`,
              type: 'function',
              function: { name: typeof block.name === 'string' ? block.name : '', arguments: '' },
            }],
          },
          finish_reason: null,
        }],
      }))
    }
  }

  if (eventType === 'content_block_delta') {
    const delta = (payload.delta ?? {}) as Record<string, unknown>
    const blockIndex = typeof payload.index === 'number' ? payload.index : null

    if (delta.type === 'text_delta' && typeof delta.text === 'string') {
      if (!state.roleEmitted) {
        chunks.push(stringifySse({
          id: state.id,
          object: 'chat.completion.chunk',
          created: state.created,
          model: state.model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        }))
        state.roleEmitted = true
      }

      chunks.push(stringifySse({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{ index: 0, delta: { content: delta.text }, finish_reason: null }],
      }))
    }

    if (
      delta.type === 'input_json_delta' &&
      typeof delta.partial_json === 'string' &&
      blockIndex !== null &&
      state.toolCallIndexByBlock[blockIndex] !== undefined
    ) {
      chunks.push(stringifySse({
        id: state.id,
        object: 'chat.completion.chunk',
        created: state.created,
        model: state.model,
        choices: [{
          index: 0,
          delta: {
            tool_calls: [{
              index: state.toolCallIndexByBlock[blockIndex],
              function: { arguments: delta.partial_json },
            }],
          },
          finish_reason: null,
        }],
      }))
    }
  }

  if (eventType === 'message_delta') {
    const delta = (payload.delta ?? {}) as Record<string, unknown>
    const usage = (payload.usage ?? {}) as Record<string, unknown>
    state.completionTokens =
      typeof usage.output_tokens === 'number' ? usage.output_tokens : state.completionTokens

    chunks.push(stringifySse({
      id: state.id,
      object: 'chat.completion.chunk',
      created: state.created,
      model: state.model,
      choices: [{ index: 0, delta: {}, finish_reason: toFinishReason(typeof delta.stop_reason === 'string' ? delta.stop_reason : null) }],
      usage: {
        prompt_tokens: state.promptTokens,
        completion_tokens: state.completionTokens,
        total_tokens: state.promptTokens + state.completionTokens,
      },
    }))
    state.finalChunkEmitted = true
  }

  if (eventType === 'message_stop') {
    chunks.push('data: [DONE]\n\n')
  }

  if (eventType === 'error') {
    chunks.push(stringifySse(payload))
  }

  return chunks
}

export function normalizeGatewayStream(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  let buffer = ''
  const state = initialState()

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = stream.getReader()

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!value) continue

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const event = parseSseEvent(line)
            if (!event) continue

            if (event.data === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              continue
            }

            const provider = detectProvider(event.json)
            if (provider && !state.provider) state.provider = provider

            if (state.provider === 'anthropic' && event.json && typeof event.json === 'object') {
              for (const chunk of normalizeAnthropicPayload(event.json as Record<string, unknown>, state)) {
                controller.enqueue(encoder.encode(chunk))
              }
              continue
            }

            controller.enqueue(encoder.encode(`${event.raw}\n\n`))
          }
        }

        if (buffer.trim()) {
          const event = parseSseEvent(buffer)
          if (event) {
            if (event.data === '[DONE]') {
              controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            } else if (state.provider === 'anthropic' && event.json && typeof event.json === 'object') {
              for (const chunk of normalizeAnthropicPayload(event.json as Record<string, unknown>, state)) {
                controller.enqueue(encoder.encode(chunk))
              }
            } else {
              controller.enqueue(encoder.encode(`${event.raw}\n\n`))
            }
          }
        }
      } finally {
        controller.close()
      }
    },
  })
}

export async function readChatCompletionFromSse(
  stream: ReadableStream<Uint8Array>,
  metadata?: RouvaResponseMeta,
): Promise<ChatCompletion> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  let id = `chatcmpl_${Date.now()}`
  let model = metadata?.model_used ?? 'unknown'
  let created = Math.floor(Date.now() / 1000)
  let content = ''
  let finishReason: string | null = null
  // Sparse by tool_calls index — fragments accumulate into each entry
  const toolCalls: FunctionToolCall[] = []
  let usage: ChatCompletionUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
  }

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (!value) continue

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        const event = parseSseEvent(line)
        if (!event || event.data === '[DONE]') continue
        if (!event.json || typeof event.json !== 'object') continue

        const payload = event.json as Record<string, unknown>
        if (payload.type === 'error' && payload.error) {
          const error = payload.error as Record<string, unknown>
          throw new Error(
            `[Rouva] Upstream error in stream: ${typeof error.message === 'string' ? error.message : 'Unknown error'}`
          )
        }

        if (typeof payload.id === 'string') id = payload.id
        if (typeof payload.model === 'string') model = payload.model
        if (typeof payload.created === 'number') created = payload.created

        const choices = Array.isArray(payload.choices) ? payload.choices : []
        const firstChoice = choices[0] as Record<string, unknown> | undefined
        const delta = firstChoice?.delta as Record<string, unknown> | undefined

        if (typeof delta?.content === 'string') {
          content += delta.content
        }

        // Assemble chunked tool_calls: the first fragment for an index carries
        // id/type/name, subsequent fragments append argument text.
        const deltaToolCalls = Array.isArray(delta?.tool_calls) ? delta.tool_calls : []
        for (const raw of deltaToolCalls) {
          const tc = raw as Record<string, unknown>
          const index = typeof tc.index === 'number' ? tc.index : 0
          const fn = (tc.function ?? {}) as Record<string, unknown>

          const existing = toolCalls[index] ?? {
            id: '',
            type: 'function' as const,
            function: { name: '', arguments: '' },
          }
          if (typeof tc.id === 'string' && tc.id) existing.id = tc.id
          if (typeof fn.name === 'string' && fn.name) existing.function.name = fn.name
          if (typeof fn.arguments === 'string') existing.function.arguments += fn.arguments
          toolCalls[index] = existing
        }
        if (typeof firstChoice?.finish_reason === 'string' || firstChoice?.finish_reason === null) {
          finishReason = firstChoice.finish_reason as string | null
        }

        const payloadUsage = payload.usage as Record<string, unknown> | undefined
        if (payloadUsage) {
          const promptTokens = typeof payloadUsage.prompt_tokens === 'number' ? payloadUsage.prompt_tokens : 0
          const completionTokens =
            typeof payloadUsage.completion_tokens === 'number' ? payloadUsage.completion_tokens : 0
          usage = {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens:
              typeof payloadUsage.total_tokens === 'number'
                ? payloadUsage.total_tokens
                : promptTokens + completionTokens,
          }
        }
      }
    }
  } finally {
    reader.releaseLock()
  }

  const assembledToolCalls = toolCalls.filter(Boolean)
  const response: ChatCompletion = {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          // OpenAI convention: content is null on pure tool-call turns
          content: content || (assembledToolCalls.length > 0 ? null : ''),
          ...(assembledToolCalls.length > 0 ? { tool_calls: assembledToolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    usage,
  }

  if (metadata && Object.keys(metadata).length > 0) {
    response._rouva = metadata
  }

  return response
}

export function getRouvaMetadata(headers: Headers): RouvaResponseMeta | undefined {
  const modelUsed = headers.get('x-rouva-model') ?? undefined
  const providerUsed = headers.get('x-rouva-provider') ?? undefined
  const taskType = headers.get('x-rouva-task') ?? undefined
  const cache = headers.get('x-rouva-cache') ?? undefined

  if (!modelUsed && !providerUsed && !taskType && !cache) return undefined

  return {
    model_used: modelUsed,
    provider_used: providerUsed,
    task_type: taskType,
    cache,
  }
}
