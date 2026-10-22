# rouva

Official Node.js SDK for [Rouva](https://rouva.io) — managed AI gateway with intelligent routing and spend tracking.

## Installation

```bash
npm install @rouvanpm/rouva
```

## Quick Start

```typescript
import { Rouva } from '@rouvanpm/rouva'

const rouva = new Rouva({ apiKey: 'rva_...' })

const response = await rouva.chat.completions.create({
  messages: [{ role: 'user', content: 'Summarize the benefits of AI routing.' }],
})

console.log(response.choices[0].message.content)
```

## Provider agnostic

Rouva works with all connected providers — Anthropic, OpenAI, Gemini, DeepSeek, Mistral, Moonshot, xAI, Z.ai and Alibaba Qwen. You can request a specific model, force a specific provider, or omit both and let Rouva route to the cheapest capable model automatically.

```typescript
// Request a specific model
const res = await rouva.chat.completions.create({
  model: 'gpt-4o',
  messages,
})

// Force a specific provider + model
const res = await rouva.chat.completions.create({
  provider: 'gemini',
  model: 'gemini-2.5-pro',
  messages,
})

// Let Rouva decide — routes to cheapest model for the task
const res = await rouva.chat.completions.create({
  messages,
})
```

## OpenAI-style request shape

```typescript
// Before
import OpenAI from 'openai'
const openai = new OpenAI({ apiKey: '...' })
const res = await openai.chat.completions.create({ messages, model: 'gpt-4o' })

// After — Rouva routes to the cheapest capable model automatically
import { Rouva } from '@rouvanpm/rouva'
const rouva = new Rouva({ apiKey: 'rva_...' })
const res = await rouva.chat.completions.create({ messages })
```

## Streaming

```typescript
const stream = await rouva.chat.completions.create({
  messages: [{ role: 'user', content: 'Write a short story.' }],
  stream: true,
})

const reader = (stream as ReadableStream).getReader()
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()
  if (done) break
  process.stdout.write(decoder.decode(value))
}
```

Streaming responses are normalized to OpenAI-style SSE chunks, even when Rouva routes the request to Anthropic.

`stream` is a client-side toggle: `stream: true` returns the raw `ReadableStream` (with the routing metadata on `_rouva` — see [Response metadata](#response-metadata)), omitting it (or `stream: false`) returns a buffered `ChatCompletion`. It is never sent to the gateway.

## Request parameters

```typescript
const res = await rouva.chat.completions.create({
  model: 'gpt-6-luna',                     // required when using seed (OpenAI only)
  messages: [{ role: 'user', content: 'Write a haiku about routing.' }],
  system: 'You are a concise assistant.',  // string or Anthropic-style text blocks
  max_tokens: 1024,                        // default 4096 (or max_completion_tokens)
  temperature: 0.7,                        // 0–1
  top_p: 0.9,                              // nucleus sampling, (0, 1]
  stop: ['END'],                           // up to 4 stop sequences
  seed: 42,                                // pins the request to this exact model
  metadata: { feature: 'search' },         // your labels, stored with the usage record
})
```

- **`temperature`** — sampling temperature between 0 and 1. The gateway omits it for models that only accept their default: OpenAI reasoning models (gpt-5 / gpt-6 families) and the Claude models that reject it (Opus 4.7 and newer, Sonnet 5 and newer, Fable).
- **`max_tokens`** / **`max_completion_tokens`** — either name works. Values below 1024 also steer auto-routing away from reasoning models, which would otherwise spend the whole budget on hidden reasoning tokens.
- **`top_p`** — nucleus sampling; `top_p: 1` is treated as omitted. OpenAI reasoning models don't support it: routing avoids them when it's set, and pinning one returns a 400. The gateway omits it for the Claude models that reject it (as for `temperature`).
- **`stop`** — a string or up to 4 stop sequences (Anthropic receives them as `stop_sequences`). OpenAI and xAI reasoning models (e.g. gpt-5, grok-4.5 / 4.6 / 4.7) reject it: routing avoids them when it's set, and pinning one returns a 400.
- **`metadata`** — up to 10 string key-value pairs (keys up to 64 characters, values up to 256, no null bytes) stored with the request's usage record; not sent to the provider.
- **`seed`** — best-effort deterministic sampling. Only OpenAI honors it, so it requires an OpenAI `model` and pins the request to that exact model (no routing, no fallbacks).
- **`response_format`** — JSON mode or a JSON schema; see [Structured output](#structured-output).
- **`reasoning_effort`** — `'none'` … `'xhigh'`, or `'max'` for Claude. Which values a model takes depends on the model; routing only picks one that takes yours; a listed OpenAI or Claude model you name that doesn't gets a 400, and other providers' models get the value as sent. On gpt-6-luna / gpt-6-sol, `'none'` turns reasoning off. See [the docs](https://rouva.io/docs#reasoning-effort).
- **`parallel_tool_calls`** — with `tools`: `false` allows at most one tool call per turn (Claude included).

Unsupported OpenAI options (`logit_bias`, `logprobs`, `n > 1`, the legacy `functions`/`function_call` fields, …) are rejected by the gateway with an explicit 400 rather than silently ignored.

## Unlisted models

`chat.completions.create()` serves the models the gateway can price — its built-in list (see `RouvaModel` and rouva.io/docs) plus models added to its synced model registry, such as new snapshots. Any other ID returns a `404` immediately:

```json
{ "error": "The model `<id>` does not exist or is not supported. See rouva.io/docs for the supported model list." }
```

`run()` also accepts an ID whose provider it can infer from the name (e.g. a dated snapshot); without a known price it's logged with no cost, and it's refused for spend-capped keys or runs with `session_budget_usd`.

`'gpt-5.6'` is a deprecated alias for `'gpt-5.6-sol'` — use the full name.

## OpenAI-compatible endpoint

Using the OpenAI SDK (or LangChain, the Vercel AI SDK, …) instead of this one? The gateway is also served at `POST /v1/chat/completions` — point `baseURL` at `https://app.rouva.io/v1` with your `rva_` key and it behaves exactly like OpenAI: `model` is required, responses are buffered JSON unless `stream: true`, and only OpenAI-format providers are available (use this SDK or the native endpoint for Anthropic models).

Non-tools requests on `/v1` honor the named model exactly unless the workspace owner has set an account routing override for the task — overrides apply as policy on every endpoint, and on `/v1` one may route to Anthropic (the response is translated back to the OpenAI format). **Tools requests on `/v1` benefit from within-provider intelligent routing** when Intelligent Routing is enabled in your dashboard — Rouva picks the cheapest capable model within the same provider, using the named `model` as a cost ceiling. The provider never changes (tool schemas are provider-specific), and `response.model` reflects the model that actually served the request. Turn Intelligent Routing off in dashboard Settings → Gateway to always pin the exact model.

## Tool use

Tools are forwarded to your target provider verbatim — define them in the **provider's own format** (OpenAI `{ type: "function", function: {...} }` or Anthropic `{ name, description, input_schema }`) and pin the matching `model`. Tool schemas are provider-specific, so `model` is required and the gateway returns a 400 without it. `gpt-6.1-sol` and `gpt-5.6-*` take tools only through OpenAI's Responses API: the gateway uses it for you and converts both ways, so you still send and receive Chat Completions (`seed`, `stop` and a `max_tokens` below 16 are a 400 there). `rouva.run()` still refuses these models.

A tools request only ever moves to another model of the **same provider**: an account routing override for the task (when it targets the same provider), or — on the `/v1` endpoint with Intelligent Routing enabled — the cheapest capable model within that provider, using the named `model` as a cost ceiling (see [OpenAI-compatible endpoint](#openai-compatible-endpoint)). Otherwise the named model is honored exactly.

```typescript
const res = await rouva.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'What is the weather in SF?' }],
  tools: [{
    type: 'function',
    function: {
      name: 'get_weather',
      description: 'Get current weather for a city',
      parameters: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  }],
})

const toolCall = res.choices[0].message.tool_calls?.[0]
if (toolCall) {
  const args = JSON.parse(toolCall.function.arguments)
  const weather = await getWeather(args.city)

  // Send the result back — same messages array plus the tool turn
  const followUp = await rouva.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'user', content: 'What is the weather in SF?' },
      res.choices[0].message,
      { role: 'tool', content: JSON.stringify(weather), tool_call_id: toolCall.id },
    ],
    tools: [/* same tools every turn */],
  })
}
```

Responses are normalized to the OpenAI shape regardless of provider: Anthropic `tool_use` blocks arrive as `message.tool_calls` (buffered) or `delta.tool_calls` chunks (streaming), with Anthropic's `stop_reason: "tool_use"` mapped to `finish_reason: "tool_calls"`. When sending Anthropic results back, use the Anthropic dialect in your messages (`tool_result` content blocks) — message payloads pass through to the provider verbatim.

**Don't branch on `finish_reason` to detect tool calls** — check for the presence of `message.tool_calls` instead. `finish_reason` follows each provider's own semantics, and OpenAI notably returns `"stop"` (not `"tool_calls"`) when `tool_choice` forces a specific function. The SDK passes OpenAI's values through unchanged so behavior matches calling OpenAI directly.

Tools requests record usage and cost. Savings are recorded when within-provider routing substitutes a cheaper model on `/v1`. Tools responses are not quality-scored, and streaming tools requests are never served from the duplicate-request cache.

## Cost optimisations

Rouva applies several cost-saving layers automatically on every non-tools request — no configuration required.

**Duplicate-request cache** — an identical request repeated within 60 seconds (typically a client retry) gets the earlier response instead of a second provider call, and isn't charged. Such responses carry `_rouva.dedup: true`.

**Prompt caching** — Anthropic requests automatically include cache-control markers on large system prompts, tool definitions and conversation prefixes, reducing input token costs on repeated turns.

**Conversation summarisation** — long Anthropic conversations are summarised by a cheap model before forwarding, compressing the context window and reducing input tokens. The summarisation cost is included in the request's spend snapshot. Only runs when the conversation exceeds ~2,000 tokens of non-system content and the request is not a tools request.

Tools requests are forwarded verbatim: no summarisation or whitespace trimming.

## Options

```typescript
const rouva = new Rouva({
  apiKey: 'rva_...',        // Required — get this from your Rouva dashboard
  baseURL: 'https://...',   // Optional — override the gateway URL
})
```

## Agentic runs — `rouva.run()`

`rouva.run()` hands the entire agent loop to the Rouva gateway. You define your tools and handler URLs; Rouva calls the model, dispatches tool calls in parallel to your endpoints, and loops until the model stops or a limit is reached — no client-side loop, no streaming required.

```typescript
const result = await rouva.run({
  model: 'claude-haiku-4-5-20251001',
  messages: [{ role: 'user', content: 'What is the weather in Paris and London?' }],
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather for a city',
      input_schema: {
        type: 'object',
        properties: { city: { type: 'string' } },
        required: ['city'],
      },
    },
  ],
  tool_handlers: {
    get_weather: 'https://api.example.com/weather',  // gateway POSTs tool input here
  },
  max_turns: 5,
  session_budget_usd: 0.10,  // optional hard cost cap
})

console.log(result.content)           // final model response
console.log(result.turns)             // number of turns taken
console.log(result.tool_calls_made)   // total tool calls dispatched
console.log(result.session_id)        // dashboard session ID
console.log(result.session_cost_usd)  // total USD spent
```

### How it works

1. The gateway sends your `messages` to the model (non-streaming)
2. When the model returns tool calls, all handlers are dispatched **in parallel** via POST — the request body is `{ "name": "<tool>", "arguments": { …the model's input… } }`, and the response body is used as the tool result
3. Results are appended and the loop continues
4. The loop exits when the model stops (`finish_reason: "stop"`, for every provider), `max_turns` is reached (`"max_turns"`), or `session_budget_usd` is reached (`"session_budget_exceeded"`). If the last turn's output is truncated, the run returns with `error` set and the truncation reason (e.g. `"length"`)

Every turn is logged as a usage snapshot in the Rouva dashboard under the shared `session_id`, giving you a full session replay with per-turn cost, model used and tool calls. (Tool-loop turns aren't quality-scored.)

### Handler URL requirements

- Must be a public HTTPS URL (private/local addresses are rejected)
- The gateway sends a `POST` with `Content-Type: application/json` and the body `{ "name": "<tool>", "arguments": { … } }`
- The response body (text or JSON) is returned to the model as the tool result

### Parameters

| Parameter | Type | Required | Description |
|---|---|---|---|
| `messages` | `ChatMessage[]` | ✓ | Conversation seed — usually a single user message |
| `tools` | `object[]` | ✓ | Tool definitions (OpenAI or Anthropic format) |
| `tool_handlers` | `Record<string, string>` | ✓ | Tool name → handler URL mapping |
| `model` | `RouvaModel` | ✓ | Model to use — required for all `/run` requests |
| `provider` | `RouvaProvider` | | Force a specific provider |
| `max_turns` | `number` | | Max loop iterations (default: 10) |
| `max_tokens` | `number` | | Max tokens per turn (default: 4096) |
| `temperature` | `number` | | Sampling temperature 0–1 |
| `session_budget_usd` | `number` | | Hard USD cap across all turns |

### Result shape

```typescript
interface RunResult {
  content: string | null            // final model response text
  turns: number                     // turns executed
  tool_calls_made: number           // total tool calls dispatched
  session_id: string                // groups all turns in the dashboard
  finish_reason: string | null      // "stop", "max_turns", "session_budget_exceeded", or a truncation reason ("length", …)
  session_cost_usd: number          // cumulative cost across all turns
  session_cost_incomplete?: boolean // a turn reported no usage — cost is a lower bound
  routed_model?: string             // when Intelligent Routing chose a different model
  requested_model?: string
  error?: string                    // why a run that still returned 200 stopped early
}
```

A non-2xx response throws a `RouvaError` (see [Errors](#errors)). Once the loop has started, its `body` also carries the partial `turns`, `session_id` and `session_cost_usd`; errors before the first turn (validation, no provider key, allowlist) carry only `error`. A run can take several minutes — pass `{ signal }` as the second argument to cancel it.

### When to use `run()` vs `chat.completions.create()`

| | `rouva.run()` | `chat.completions.create()` |
|---|---|---|
| Tool loop | Gateway-managed | Client-managed |
| Session grouping | Automatic | Manual (`startSession`) |
| Streaming | No | Yes |
| Use when | Fully delegating an agentic task | Building your own loop or need streaming |

## Agent session tracking

Group all turns of an agent run under a single session ID so the Rouva dashboard can show per-session cost, token usage, and quality. Use this with `chat.completions.create()` when you manage the loop yourself.

```typescript
const rouva = new Rouva({ apiKey: 'rva_...' })

// Start a session — auto-generates an ID and attaches it to every request
const sessionId = rouva.startSession()

// All turns carry the same session ID automatically
await rouva.chat.completions.create({ messages: [...], tools: [...] })
await rouva.chat.completions.create({ messages: [...], tools: [...] })
await rouva.chat.completions.create({ messages: [...], tools: [...] })

// End the session when the agent run is complete
rouva.endSession()
```

You can also read the active session ID at any time:

```typescript
console.log(rouva.sessionId) // 'rva-sess-abc123' or undefined
```

Sessions are optional — requests without an active session are tracked individually as before.

## Response metadata

Every response says what Rouva decided, in `_rouva` — on a buffered completion, and on the stream `stream: true` returns (the headers arrive before the first chunk):

```typescript
const res = await rouva.chat.completions.create({ messages })

console.log(res._rouva)
// {
//   request_id: '7c0e…',          // your request log's id for it
//   model_used: 'gpt-6-luna',
//   provider_used: 'openai',
//   requested_model: 'gpt-6-sol', // only when Rouva served a different model
//   task_type: 'summarize',
//   route_reason: 'intelligent',  // override | allowlist | fallback | no_key_fallback | direct | escalation | dedup
//   dedup: true                   // only when served from the duplicate-request cache
// }
```

### Cost, savings and quality score — `rouva.requests.get(id)`

A request's cost is known only once its last chunk has arrived, and its quality score once the judge has run, so read them back by `request_id`:

```typescript
import type { RouvaStream } from '@rouvanpm/rouva'

const stream = await rouva.chat.completions.create({ messages, stream: true }) as RouvaStream
// ...consume the stream...

const id = stream._rouva?.request_id // absent on a duplicate-cache replay (cost 0)
if (id) {
  const req = await rouva.requests.get(id)
  console.log(req.status)        // 'pending' | 'incomplete' | 'settled' | 'scored'
  console.log(req.cost_usd)      // e.g. 0.000412
  console.log(req.saved_usd)     // vs the model you named (negative when the route cost more)
  console.log(req.quality_score) // 0–1, once scored
  console.log(req.dashboard_url) // opens it in your request log
}
```

`pending` means it hasn't settled yet — retry after a moment. `incomplete` means it settled from partial usage (a stream cut short), so the provider may have billed more; `settled` and `scored` costs are final. A key reads only its own requests. A duplicate-cache replay has no `request_id` (nothing new was recorded or charged).

## Explain a routing decision — `rouva.explain()`

A dry run: the model Rouva would pick for a request, why, and the most it could cost — without calling a provider, recording a request or reserving spend.

```typescript
const e = await rouva.explain({ model: 'gpt-6-sol', messages })

if (e.would_send) {
  console.log(e.model, e.provider)   // e.g. 'gpt-6-luna', 'openai'
  console.log(e.route_reason)        // 'intelligent' | 'override' | 'allowlist' | 'direct' | …
  console.log(e.task_type)           // e.g. 'summarize'
  console.log(e.max_cost_usd)        // what a spend-capped key would reserve
} else {
  console.log(e.status, e.error)     // the refusal the real request would get
}
```

It takes the same params as `chat.completions.create()`; pass `{ endpoint: 'v1' }` to explain the same body sent to `/v1/chat/completions`. The prompt is classified as for a real request, and explain has its own per-minute rate limit (a `RouvaError` with `refusal: 'rate'`). Not covered: the duplicate-request cache, a spend cap's remaining budget, and what the provider answers.

## Structured output

`response_format` asks for JSON: `{ type: 'json_object' }` (JSON mode — your prompt must mention "json") or `{ type: 'json_schema', json_schema: { name, schema, strict } }` (the answer follows your schema). Rouva only routes to models that serve the format; see [the docs](https://rouva.io/docs#structured-output) for which models do.

```typescript
import type { ChatCompletion } from '@rouvanpm/rouva'

const res = await rouva.chat.completions.create({
  messages: [{ role: 'user', content: 'Extract the city: "Flying to Paris on Monday."' }],
  response_format: {
    type: 'json_schema',
    json_schema: {
      name: 'city',
      strict: true,
      schema: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'], additionalProperties: false },
    },
  },
}) as ChatCompletion
const { city } = JSON.parse(res.choices[0].message.content!)
```

## Errors

Any non-2xx response throws a `RouvaError` (a subclass of `Error`, so existing `catch` blocks keep working):

```typescript
import { Rouva, RouvaError } from '@rouvanpm/rouva'

try {
  await rouva.chat.completions.create({ messages })
} catch (e) {
  if (e instanceof RouvaError && e.status === 429) {
    console.log(e.refusal)     // 'key_cap' | 'member_cap' | 'rate' | … — Rouva refused before calling the provider
    console.log(e.retryAfter)  // seconds, from Retry-After
    console.log(e.error)       // the gateway's message
    console.log(e.requestId)   // when the request was recorded — rouva.requests.get(e.requestId)
  }
}
```

`refusal` (header `X-Rouva-Refusal`) names why Rouva itself refused the request before contacting the provider, when the gateway marks it: a monthly spend cap would be exceeded (`key_cap`, `member_cap`), the rate limit (`rate`), for spend-capped keys a model with no known price (`unpriced`) or input or a model whose cost can't be bounded (`unbounded`), or — a `504` — the request ran out of its time budget before the provider was called (`deadline`; nothing was sent, so it's safe to retry, and `retryAfter` is set). Every Rouva refusal is marked, so a `429` or `504` without `refusal` came from the provider, not from Rouva — with one exception: `rouva.run()` returns an unmarked `504` "Run deadline exceeded before completion" when the run runs out of time, because earlier turns were already billed and their tool handlers ran; check what completed before retrying it. Every call also takes `{ signal }` as a second argument to abort it.

## Getting your API key

1. Sign in to [app.rouva.io](https://app.rouva.io)
2. Go to **Settings → Gateway Key**
3. Generate a key — it starts with `rva_`

## License

MIT
