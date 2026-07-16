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

/** OpenAI-dialect tool call, as emitted on assistant messages */
export interface FunctionToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    /** JSON-encoded arguments string */
    arguments: string
  }
}

/** OpenAI-dialect assistant turn that requested tool calls */
export interface AssistantToolCallMessage {
  role: 'assistant'
  content: string | null
  tool_calls: FunctionToolCall[]
}

/** OpenAI-dialect tool result turn */
export interface ToolResultMessage {
  role: 'tool'
  content: string
  tool_call_id: string
}

/**
 * Anthropic-dialect turn whose content is an array of content blocks
 * (e.g. `tool_use` on assistant turns, `tool_result` on user turns).
 * Blocks are forwarded to the gateway verbatim.
 */
export interface ContentBlockMessage {
  role: 'user' | 'assistant'
  content: Array<Record<string, unknown>>
}

/**
 * Any message the gateway accepts. Plain chat uses `Message`; tool
 * conversations additionally use the tool-shaped variants, which are only
 * valid when `tools` is set on the request.
 */
export type ChatMessage =
  | Message
  | AssistantToolCallMessage
  | ToolResultMessage
  | ContentBlockMessage

export type RouvaProvider =
  | 'anthropic'
  | 'openai'
  | 'gemini'
  | 'deepseek'
  | 'mistral'
  | 'moonshot'
  | 'xai'
  | 'zai'
  | (string & {})

/**
 * Supported models across all providers.
 * Omit `model` entirely to let Rouva route to the cheapest capable model automatically.
 */
export type RouvaModel =
  // Anthropic
  | 'claude-opus-4-6'
  | 'claude-opus-4-7'
  | 'claude-opus-4-8'
  | 'claude-sonnet-4-6'
  | 'claude-sonnet-5'
  | 'claude-haiku-4-5-20251001'
  | 'claude-fable-5'
  // OpenAI — GPT-5 family
  | 'gpt-5-nano'
  | 'gpt-5-mini'
  | 'gpt-5'
  | 'gpt-5.6'
  // OpenAI — GPT-4.1 family
  | 'gpt-4.1-nano'
  | 'gpt-4.1-mini'
  | 'gpt-4.1'
  // OpenAI — GPT-4o family
  | 'gpt-4o'
  | 'gpt-4o-mini'
  // Gemini
  | 'gemini-2.5-flash'
  | 'gemini-2.5-pro'
  // DeepSeek
  | 'deepseek-v4-flash'
  | 'deepseek-v4-flash-think'
  | 'deepseek-v4-pro'
  // Mistral
  | 'mistral-small-latest'
  | 'mistral-large-latest'
  // Moonshot
  | 'kimi-k2.6'
  // xAI
  | 'grok-4.3'
  | 'grok-4.20-0309-reasoning'
  | 'grok-4.5'
  // Z.ai
  | 'glm-4.7-flash'
  | 'glm-5.2'
  // Allow any string for forward compatibility
  | (string & {})

/** Anthropic-style text block — the array form of the `system` param */
export interface SystemTextBlock {
  type: 'text'
  text: string
}

export interface ChatCompletionParams {
  messages: ChatMessage[]
  /**
   * System prompt — a plain string or Anthropic-style text blocks.
   * Equivalent to a `role: "system"` message at the head of `messages`;
   * the gateway accepts both forms and re-emits whichever dialect the
   * routed provider expects, so it survives cross-provider routing.
   */
  system?: string | SystemTextBlock[]
  /**
   * Target model — omit to let Rouva route intelligently to the cheapest capable model.
   * Supports models from any connected provider (Anthropic, OpenAI).
   */
  model?: RouvaModel
  /**
   * Force an exact provider when paired with `model`.
   * Omit to let Rouva auto-route based on your connected keys.
   */
  provider?: RouvaProvider
  /** Maximum tokens to generate */
  max_tokens?: number
  /**
   * Sampling temperature 0–1.
   * Note: reasoning models (gpt-5 family) only support their default
   * temperature, so the gateway omits it for those.
   */
  temperature?: number
  /**
   * Stream the response. Client-side only — controls whether `create()`
   * returns a ReadableStream or a buffered ChatCompletion; never sent to
   * the gateway.
   */
  stream?: boolean
  /**
   * Tool definitions in your target provider's own format, forwarded to the
   * provider verbatim (OpenAI `{ type: "function", function: {...} }` or
   * Anthropic `{ name, description, input_schema }`). Requires `model` —
   * tool schemas are provider-specific, so tools requests are never
   * re-routed by the gateway.
   */
  tools?: Array<Record<string, unknown>>
  /**
   * Tool choice in your target provider's own format, forwarded verbatim.
   * Only valid alongside `tools`.
   */
  tool_choice?: string | Record<string, unknown>
}

/** Assistant message in a completed response; `tool_calls` present when the model requested tools */
export interface ResponseMessage {
  role: 'assistant'
  content: string | null
  tool_calls?: FunctionToolCall[]
}

export interface ChatCompletionChoice {
  index: number
  message: ResponseMessage
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
  /** Actual model used when exposed by the gateway */
  model_used?: string
  /** Actual provider used when exposed by the gateway */
  provider_used?: string
  /** Task type classified by Rouva when exposed by the gateway */
  task_type?: string
  /** Semantic cache status when exposed by the gateway */
  cache?: string
}
