/** Per-call options. */
export interface RequestOptions {
  /** Abort the request (e.g. a long `run()` the user navigated away from). */
  signal?: AbortSignal
}

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
 * Supported models across all providers (the gateway's list as of SDK 0.3.0).
 * Omit `model` entirely to let Rouva route to the cheapest capable model automatically.
 *
 * Other IDs are accepted by the type for forward compatibility. On
 * `chat.completions.create()` the gateway only serves models it can price
 * (its built-in list plus its synced model registry); any other ID returns a
 * 404. `run()` also accepts IDs whose provider it can infer from the name,
 * logging them without a cost unless the key is spend-capped or the run has a
 * `session_budget_usd` (then an unpriced model is refused).
 *
 * `'gpt-5.6'` is a deprecated alias the gateway maps to `'gpt-5.6-sol'`.
 */
export type RouvaModel =
  // Anthropic
  | 'claude-fable-5-1'
  | 'claude-fable-5'
  | 'claude-opus-5-5'
  | 'claude-opus-5'
  | 'claude-opus-4-8'
  | 'claude-opus-4-7'
  | 'claude-opus-4-6'
  | 'claude-sonnet-5-5'
  | 'claude-sonnet-5'
  | 'claude-sonnet-4-6'
  | 'claude-haiku-4-5-20251001'
  // OpenAI — GPT-6 family
  | 'gpt-6.1-sol'
  | 'gpt-6-sol'
  | 'gpt-6-luna'
  // OpenAI — GPT-5 family
  | 'gpt-5.6-sol'
  | 'gpt-5.6-terra'
  | 'gpt-5.6-luna'
  | 'gpt-5.6'   // deprecated alias of gpt-5.6-sol
  | 'gpt-5'
  | 'gpt-5.4-mini'
  | 'gpt-5-mini'
  | 'gpt-5-nano'
  // OpenAI — GPT-4.1 / 4o families: OpenAI retires these on 2027-01-14 (use
  // gpt-6-luna); the gateway no longer routes to them on its own, but a request
  // that names one still reaches it until then. (gpt-4.1-nano — OpenAI shuts it
  // down on 2026-10-23 — was removed in 0.3.2.)
  | 'gpt-4.1'
  | 'gpt-4.1-mini'
  | 'gpt-4o'
  | 'gpt-4o-mini'
  // Gemini
  | 'gemini-3.8-flash'
  | 'gemini-3.7-flash'
  | 'gemini-3.6-flash'
  | 'gemini-3.5-flash-lite'
  | 'gemini-2.5-pro'
  | 'gemini-2.5-flash'
  // DeepSeek (deepseek-flash-think = deepseek-flash with thinking on). The old
  // ids deepseek-v4-flash, deepseek-v4-flash-think and deepseek-flash-4-1 were
  // removed in 0.3.2; the gateway still maps them to these.
  | 'deepseek-flash'
  | 'deepseek-flash-think'
  | 'deepseek-v4-pro'
  // Mistral
  | 'mistral-large-latest'
  | 'mistral-small-latest'
  // Moonshot
  | 'kimi-k3'
  | 'kimi-k2.6'
  // xAI
  | 'grok-4.7'
  | 'grok-4.6'
  | 'grok-4.5'
  | 'grok-4.3'
  | 'grok-4.20-0309-reasoning'
  // Z.ai
  | 'glm-5.3'
  | 'glm-5.2'
  | 'glm-4.7-flash'
  // Alibaba Qwen
  // (qwen-turbo, qwen3-235b-a22b, qwen3-32b and qwen3-30b-a3b were retired by
  // Alibaba on 2026-10-10 and removed in 0.3.1)
  | 'qwen3.8-omni-flash'
  | 'qwen3.8-flash'
  | 'qwen3.7-plus'
  | 'qwen-max'
  | 'qwen-plus'
  | 'qwen-flash'
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
   * Target model — omit to let Rouva route intelligently to the cheapest
   * capable model. With Intelligent Routing on, a named model is a price
   * ceiling for Rouva's own choices: it may substitute a cheaper capable model,
   * never a pricier one (retries after a provider error included). Two
   * exceptions: an account routing override set by the workspace owner applies
   * as policy, even if pricier; and with `provider` also set, the exact model
   * is used (no substitution).
   */
  model?: RouvaModel
  /**
   * Force an exact provider when paired with `model`.
   * Omit to let Rouva auto-route based on your connected keys.
   */
  provider?: RouvaProvider
  /** Maximum tokens to generate */
  max_tokens?: number
  /** OpenAI's newer name for `max_tokens`; the gateway accepts either. */
  max_completion_tokens?: number
  /**
   * Your own labels for the request, stored with its usage record and not
   * sent to the provider: up to 10 string key-value pairs, keys up to 64
   * characters, values up to 256 characters, no null bytes.
   */
  metadata?: Record<string, string>
  /**
   * Sampling temperature 0–1.
   * The gateway omits it for models that only accept their default: OpenAI
   * reasoning models (gpt-5 / gpt-6 families) and the Claude models that reject
   * it (Opus 4.7 and newer, Sonnet 5 and newer, Fable).
   */
  temperature?: number
  /**
   * Nucleus sampling — greater than 0 and at most 1. `top_p: 1` (the no-op
   * default) is treated as omitted. OpenAI reasoning models (gpt-5 / gpt-6
   * families, o-series) don't support it: routing avoids them when top_p is
   * set, and pinning one returns a 400. The gateway omits it for the Claude
   * models that reject it (Opus 4.7 and newer, Sonnet 5 and newer, Fable).
   */
  top_p?: number
  /**
   * Up to 4 stop sequences — a string or array of non-empty strings
   * (Anthropic receives them as `stop_sequences`). OpenAI and xAI reasoning
   * models (e.g. gpt-5, grok-4.5 / 4.6 / 4.7) reject `stop`: routing avoids
   * them when it is set, and pinning one returns a 400.
   */
  stop?: string | string[]
  /**
   * Best-effort deterministic sampling. Only OpenAI honors it, so it
   * requires an OpenAI `model` and pins the request to that exact model —
   * no cheaper-model substitution, no cross-provider fallbacks.
   */
  seed?: number
  /**
   * Ask for JSON output (gateway support since 2026-10-20). `json_object` is
   * JSON mode: the prompt (a message or `system`) must contain the word
   * "json", or the gateway returns a 400. `json_schema` is Structured Outputs:
   * the answer follows your schema. Routing only picks a model that serves the
   * format; Claude models serve `json_schema` only (every object needs
   * `additionalProperties: false`), and not when the conversation ends with an
   * assistant message. `{ type: 'text' }` or `null` is the default (no-op).
   * `rouva.run()` doesn't accept it. See https://rouva.io/docs#structured-output
   */
  response_format?: ResponseFormat | null
  /**
   * How hard a reasoning model thinks (gateway support since 2026-10-21).
   * OpenAI models take it as is; Claude gets it as `output_config.effort`.
   * Values depend on the model: gpt-5 / -mini / -nano take minimal–high;
   * gpt-5.4-mini, gpt-5.6-*, gpt-6-luna / -sol take none–xhigh; gpt-6.1-sol
   * low–xhigh; Claude Sonnet / Opus 4.6 low, medium, high, max; newer Claude
   * models also xhigh; GPT-4 models and Claude Haiku 4.5 don't take it. Routing
   * only picks a model that takes the value; a model you name that doesn't is
   * a 400. On gpt-6-luna / -sol, `'none'` turns reasoning off (temperature,
   * top_p and tools then work) and any other value turns it on (tools and
   * top_p are then a 400). `rouva.run()` doesn't accept it.
   * See https://rouva.io/docs#reasoning-effort
   */
  reasoning_effort?: ReasoningEffort | null
  /**
   * With `tools` only: `false` limits the model to at most one tool call per
   * turn. Forwarded to OpenAI-format providers; for Claude the gateway sets
   * `disable_parallel_tool_use` on `tool_choice`. `rouva.run()` doesn't accept it.
   */
  parallel_tool_calls?: boolean | null
  /**
   * Stream the response. Client-side only — controls whether `create()`
   * returns a ReadableStream or a buffered ChatCompletion; never sent to
   * the gateway.
   */
  stream?: boolean
  /**
   * Tool definitions in your target provider's own format, forwarded to the
   * provider verbatim (OpenAI `{ type: "function", function: {...} }` or
   * Anthropic `{ name, description, input_schema }`). Requires `model`.
   * Tool schemas are provider-specific, so a tools request only ever moves to
   * another model of the SAME provider (a routing override, or cheaper-model
   * routing on /v1). Models that don't support tools on Chat Completions
   * (gpt-6.1-sol, gpt-5.6-*) return a 400.
   */
  tools?: Array<Record<string, unknown>>
  /**
   * Tool choice in your target provider's own format, forwarded verbatim.
   * Only valid alongside `tools`.
   */
  tool_choice?: string | Record<string, unknown>
}

/** `reasoning_effort` values the gateway accepts (which ones a model takes varies). */
export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** `response_format` values the gateway accepts. */
export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema'
      json_schema: {
        /** 1–64 letters, digits, underscores or dashes. */
        name: string
        /** A JSON Schema object. */
        schema: Record<string, unknown>
        strict?: boolean
        description?: string
      }
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

/**
 * Why Rouva sent a request to the model it did (header `X-Rouva-Route-Reason`):
 * `intelligent` (Intelligent Routing chose it), `override` (an account routing
 * override), `allowlist` (a workspace member's allowed-model list),
 * `fallback` (a retry after a provider error), `escalation` (`run()` stepped
 * up a model), `no_key_fallback` (the named provider has no key, so a
 * connected one stood in), `direct` (the model you named, as named), or
 * `dedup` (a replay of an identical request — no new call was made).
 */
export type RouvaRouteReason =
  | 'intelligent'
  | 'override'
  | 'allowlist'
  | 'fallback'
  | 'escalation'
  | 'no_key_fallback'
  | 'direct'
  | 'dedup'
  | (string & {})

export interface RouvaResponseMeta {
  /**
   * The request's id in your Rouva request log (`X-Rouva-Request-Id`). Pass it
   * to `rouva.requests.get(id)` for the request's cost, savings and quality
   * score. Absent on a duplicate-cache replay (no new request was recorded).
   */
  request_id?: string
  /** The model that served the request — after a fallback, the fallback model. */
  model_used?: string
  /** That model's provider, e.g. `openai`, `anthropic`. */
  provider_used?: string
  /** The model you named, when Rouva served a different one. */
  requested_model?: string
  /** Task type classified by Rouva, e.g. `code`; absent when not classified. */
  task_type?: string
  /** Why this model was chosen. */
  route_reason?: RouvaRouteReason
  /**
   * What the request cost in USD, when the gateway sent it in a header: only
   * on non-streaming responses once the cost is final, and as 0 on a
   * duplicate-cache replay (`dedup: true`). The SDK streams, so otherwise read
   * cost with `rouva.requests.get(request_id)`.
   */
  cost_usd?: number
  /** Saved against the model you named (or the priciest candidate), in USD; negative when the route cost more. Same availability as `cost_usd`. */
  saved_usd?: number
  /**
   * True when the gateway answered from its duplicate-request cache (an
   * identical request within the last 60 seconds) instead of calling the
   * provider — that request wasn't charged. Header: `X-Rouva-Dedup`.
   */
  dedup?: boolean
  /**
   * @deprecated The semantic cache was removed from the gateway (2026-10-08),
   * so this is never set. Use `dedup`.
   */
  cache?: string
}

/**
 * The stream `chat.completions.create({ stream: true })` returns: OpenAI-shaped
 * SSE bytes, plus the routing metadata from the response headers (known
 * before the first chunk).
 */
export type RouvaStream = ReadableStream<Uint8Array> & { _rouva?: RouvaResponseMeta }

/**
 * A request's settlement state: `pending` (not settled yet — in flight, or it
 * never reached the provider), `incomplete` (settled from partial usage, e.g. a
 * stream cut short — the provider may have billed more), `settled` (tokens and
 * cost are final), `scored` (final, and a quality score is recorded).
 */
export type RouvaRequestStatus = 'pending' | 'incomplete' | 'settled' | 'scored' | (string & {})

/** One request from your request log — `rouva.requests.get(id)`. */
export interface RouvaRequest {
  id: string
  /** ISO timestamp. */
  created_at: string
  status: RouvaRequestStatus
  provider: string
  model: string
  requested_model: string | null
  task_type: string | null
  route_reason: RouvaRouteReason | null
  /** 0 while pending. */
  input_tokens: number
  output_tokens: number
  /** USD; 0 while pending. Final once `status` is `settled` or `scored`. */
  cost_usd: number
  /** USD saved against the model you named (or the priciest candidate); negative when the route cost more. */
  saved_usd: number
  /** 0–1, or null until a score is recorded (or when none is). */
  quality_score: number | null
  /** Whether the judge scored it, or why not (then `quality_score` is the heuristic checks'). */
  judge_status: string | null
  finish_reason: string | null
  session_id: string | null
  /** Opens this request in the dashboard's request log. */
  dashboard_url: string
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
   * POSTs `{ "name": <tool name>, "arguments": <the model's input object> }`
   * as JSON to the corresponding URL and feeds the response body back as the
   * tool result. All handlers must be public HTTPS endpoints.
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
   * schema translation automatically. Required by /run.
   */
  model: RouvaModel
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
   * Hard cap on total session spend in USD. The loop exits cleanly (with
   * `finish_reason: "session_budget_exceeded"`) when the cumulative cost of
   * all turns reaches this threshold.
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
   * Why the loop exited: `"stop"` (the model finished — reported as "stop" for
   * every provider), `"max_turns"` (turn limit reached),
   * `"session_budget_exceeded"` (session_budget_usd hit), or a truncation
   * reason such as `"length"` / `"max_tokens"` (then `error` explains it).
   */
  finish_reason: string | null
  /** Cumulative USD cost of all turns in the session. */
  session_cost_usd: number
  /**
   * True when a turn reported no usage, so `session_cost_usd` is a lower
   * bound rather than the full cost.
   */
  session_cost_incomplete?: boolean
  /** Set when Intelligent Routing chose a different model than requested. */
  routed_model?: string
  requested_model?: string
  /**
   * Explanation when the run stopped early but still returned 200 — e.g.
   * output truncated on the last turn (raise `max_tokens`).
   */
  error?: string
}
