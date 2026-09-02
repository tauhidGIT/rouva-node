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
  | 'alibaba'
  | (string & {})

/**
 * Supported models across all providers.
 * Omit `model` entirely to let Rouva route to the cheapest capable model automatically.
 *
 * IDs not listed here also work when pinned — dated snapshots
 * (`gpt-4o-mini-2024-07-18`), fine-tunes (`ft:gpt-4o-mini:…`), and new
 * releases are matched to their provider by naming convention and forwarded
 * as-is. Until the gateway's registry knows their pricing, such requests are
 * logged with token counts but zero cost.
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
  | 'gpt-5.4-mini'
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
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
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
  | 'kimi-k3'
  // xAI
  | 'grok-4.6'
  | 'grok-4.5'
  | 'grok-4.3'
  | 'grok-4.20-0309-reasoning'
  // Z.ai
  | 'glm-4.7-flash'
  | 'glm-5.2'
  // Alibaba Qwen
  | 'qwen-turbo'
  | 'qwen-plus'
  | 'qwen-max'
  | 'qwen3-30b-a3b'
  | 'qwen3-32b'
  | 'qwen3-235b-a22b'
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
   * Nucleus sampling — greater than 0 and at most 1, forwarded to every
   * provider. `top_p: 1` (the no-op default) is treated as omitted. OpenAI
   * reasoning models (gpt-5 family, o-series) don't support it: auto-routing
   * avoids them when top_p is set, and pinning one returns a 400.
   */
  top_p?: number
  /**
   * Up to 4 stop sequences — a string or array of non-empty strings,
   * forwarded to every provider (Anthropic receives them as
   * `stop_sequences`).
   */
  stop?: string | string[]
  /**
   * Best-effort deterministic sampling. Only OpenAI honors it, so it
   * requires an OpenAI `model` and pins the request to that exact model —
   * no cheaper-model substitution, no cross-provider fallbacks.
   */
  seed?: number
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

export interface RunParams {
  /**
   * Conversation history to seed the agent loop with.
   * Typically a single user message, but may include prior turns for
   * multi-shot agents.
   */
  messages: ChatMessage[]
  /**
   * Tool definitions to expose to the model. Accepts both OpenAI-style
   * `{ type: "function", function: { name, description, parameters } }` and
   * Anthropic-style `{ name, description, input_schema }` objects.
   * At least one tool is required.
   *
   * The gateway's canonical translation layer normalizes tool schemas to the
   * correct wire format for the selected provider on every turn — you do not
   * need to convert between formats. Same-provider turns replay schemas
   * verbatim, preserving vendor-specific fields like `strict` (OpenAI) or
   * `cache_control` (Anthropic) exactly as supplied.
   */
  tools: Array<Record<string, unknown>>
  /**
   * Map of tool name → handler URL. When the model calls a tool, the gateway
   * POSTs the tool input as JSON to the corresponding URL and feeds the
   * response body back as the tool result. All handlers must be public HTTPS
   * endpoints.
   *
   * @example
   * { search: 'https://api.example.com/search', calculator: 'https://api.example.com/calc' }
   */
  tool_handlers: Record<string, string>
  /**
   * Target model. Intelligent Routing selects a provider and model once before
   * the loop begins — the session stays on that provider for all turns. When
   * the session history is fully translatable, routing may cross the
   * Anthropic ↔ OpenAI-compatible boundary; the canonical layer handles tool
   * schema translation automatically. Omit to let Rouva select the cheapest
   * capable model automatically.
   */
  model?: RouvaModel
  /**
   * Force a specific provider when paired with `model`.
   */
  provider?: RouvaProvider
  /**
   * Maximum number of agentic turns before the loop exits.
   * Defaults to 10. Each turn = one model call (plus parallel tool dispatch).
   */
  max_turns?: number
  /**
   * Maximum tokens the model may generate per turn.
   * Defaults to 4096.
   */
  max_tokens?: number
  /**
   * Sampling temperature 0–1.
   */
  temperature?: number
  /**
   * Hard cap on total session spend in USD. The loop exits cleanly when the
   * cumulative cost of all turns reaches this threshold.
   */
  session_budget_usd?: number
}

export interface RunResult {
  /** Final model response text after all tool loops complete. */
  content: string | null
  /** Number of agentic turns executed. */
  turns: number
  /** Total number of tool calls dispatched across all turns. */
  tool_calls_made: number
  /** Session ID — all turns are grouped under this ID in the Rouva dashboard. */
  session_id: string
  /**
   * Why the loop exited: `"stop"` (model finished), `"max_turns"` (turn limit
   * reached), `"budget_exceeded"` (session_budget_usd hit), or a provider
   * finish reason such as `"end_turn"` or `"length"`.
   */
  finish_reason: string | null
  /** USD cost of the final turn. */
  cost_usd: number
  /** Cumulative USD cost of all turns in the session. */
  session_cost_usd: number
}
