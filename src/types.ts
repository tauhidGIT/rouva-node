export interface RouvaOptions {
  /** Your Rouva gateway API key (rva_...) */
  apiKey: string
  /** Override the default gateway URL — useful for self-hosted or testing */
  baseURL?: string
}

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/**
 * Supported models across all providers.
 * Omit `model` entirely to let Rouva route to the cheapest capable model automatically.
 */
export type RouvaModel =
  // Anthropic
  | 'claude-opus-4-6'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001'
  // OpenAI
  | 'gpt-4o'
  | 'gpt-4o-mini'
  | 'gpt-4-turbo'
  | 'gpt-3.5-turbo'
  // Allow any string for forward compatibility
  | (string & {})

export interface ChatCompletionParams {
  messages: Message[]
  /**
   * Target model — omit to let Rouva route intelligently to the cheapest capable model.
   * Supports models from any connected provider (Anthropic, OpenAI).
   */
  model?: RouvaModel
  /** Maximum tokens to generate */
  max_tokens?: number
  /** Sampling temperature 0–1 */
  temperature?: number
  /** Stream the response */
  stream?: boolean
}

export interface ChatCompletionChoice {
  index: number
  message: Message
  finish_reason: string | null
}

export interface ChatCompletionUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

export interface ChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: ChatCompletionChoice[]
  usage: ChatCompletionUsage
  /** Rouva metadata — cost, savings, routing decision */
  _rouva?: RouvaResponseMeta
}

export interface RouvaResponseMeta {
  /** Actual model used (may differ from requested when intelligently routed) */
  model_used: string
  /** USD cost for this request */
  cost: number
  /** USD saved vs your baseline model */
  savings: number
  /** Whether intelligent routing selected the model */
  intelligently_routed: boolean
  /** Task type classified by Rouva */
  task_type: string
}