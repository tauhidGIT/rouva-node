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

Rouva works with all connected providers — Anthropic, OpenAI, Gemini, DeepSeek, Mistral, Moonshot, xAI, and Z.ai. You can request a specific model, force a specific provider, or omit both and let Rouva route to the cheapest capable model automatically.

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

`stream` is a client-side toggle: `stream: true` returns the raw `ReadableStream`, omitting it (or `stream: false`) returns a buffered `ChatCompletion`. It is never sent to the gateway.

## Request parameters

```typescript
const res = await rouva.chat.completions.create({
  messages: [{ role: 'user', content: 'Write a haiku about routing.' }],
  system: 'You are a concise assistant.',  // string or Anthropic-style text blocks
  max_tokens: 1024,                        // default 4096
  temperature: 0.7,                        // 0–1
})
```

- **`temperature`** — sampling temperature between 0 and 1. Reasoning models (the gpt-5 family) only support their default temperature, so the gateway omits it when routing to one.
- **`max_tokens`** — values below 1024 also steer auto-routing away from reasoning models, which would otherwise spend the whole budget on hidden reasoning tokens.

### Not yet supported

Tool use (`tools`, `tool_choice`, assistant `tool_calls`, `role: "tool"` messages) is not supported yet — the gateway rejects these with a clear 400 rather than silently dropping them. Tools support is planned.

## Options

```typescript
const rouva = new Rouva({
  apiKey: 'rva_...',        // Required — get this from your Rouva dashboard
  baseURL: 'https://...',   // Optional — override the gateway URL
})
```

## Response metadata

Parsed non-stream responses may include a `_rouva` field with gateway header metadata when available:

```typescript
const res = await rouva.chat.completions.create({ messages })

console.log(res._rouva)
// {
//   model_used: 'gpt-4o-mini',
//   provider_used: 'openai',
//   task_type: 'summarize'
// }
```

## Getting your API key

1. Sign in to [app.rouva.io](https://app.rouva.io)
2. Go to **Settings → Gateway Key**
3. Generate a key — it starts with `rva_`

## License

MIT
