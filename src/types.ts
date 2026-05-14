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

export interface ChatCompletionParams {
  messages: Message[]
  /** Target model — omit to let Rouva route intelligently */
  model?: string
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