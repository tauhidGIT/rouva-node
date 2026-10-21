/**
 * Thrown for any non-2xx gateway response. Extends Error and keeps the
 * message format of earlier versions (`[Rouva] Gateway error 429: …`), so
 * existing `catch` blocks keep working; the fields make refusals actionable.
 */
export class RouvaError extends Error {
  /** HTTP status from the gateway. */
  readonly status: number
  /**
   * Why Rouva itself refused the request before contacting the provider, when
   * the gateway marks it (header `X-Rouva-Refusal`): `"key_cap"` /
   * `"member_cap"` (a monthly spend cap would be exceeded), `"rate"` (rate
   * limit), `"unpriced"` (a capped key can't use a model with no known price),
   * `"unbounded"` (a capped key can't send input, or use a model, whose cost
   * can't be bounded), `"deadline"` (a 504: the request ran out of its time
   * budget before the provider was called — nothing was sent, so it's safe to
   * retry; `retryAfter` is set). Every Rouva cap, rate-limit, pricing and time
   * refusal carries it, so a 429 or 504 without `refusal` came from the
   * provider — except `rouva.run()`'s "Run deadline exceeded" 504, which is
   * Rouva's but deliberately unmarked: earlier turns were billed and their
   * tool handlers ran, so it must not be retried blindly.
   */
  readonly refusal?: string
  /** Seconds to wait before retrying, from `Retry-After`, when present. */
  readonly retryAfter?: number
  /** The gateway's error message (`error` field), when the body is JSON. */
  readonly error?: string
  /**
   * The request's id in your Rouva request log (`X-Rouva-Request-Id`), when
   * the error came after the request was recorded — e.g. a provider error.
   * Look it up with `rouva.requests.get(requestId)`. Absent on errors Rouva
   * returns before recording the request (validation 400s, auth).
   */
  readonly requestId?: string
  /** The parsed JSON body, or the raw text when it isn't JSON. */
  readonly body: unknown

  constructor(kind: 'Gateway' | 'Run' | 'Request', status: number, headers: Headers, rawBody: string) {
    super(`[Rouva] ${kind} error ${status}: ${rawBody}`)
    this.name = 'RouvaError'
    this.status = status
    this.refusal = headers.get('x-rouva-refusal') ?? undefined
    const retry = Number(headers.get('retry-after'))
    this.retryAfter = headers.get('retry-after') !== null && Number.isFinite(retry) ? retry : undefined
    this.requestId = headers.get('x-rouva-request-id') || headers.get('x-rouva-row-id') || undefined
    let parsed: unknown = rawBody
    try { parsed = JSON.parse(rawBody) } catch { /* plain text */ }
    this.body = parsed
    const e = (parsed as { error?: unknown } | null)?.error
    this.error = typeof e === 'string' ? e : undefined
  }
}

export async function toRouvaError(kind: 'Gateway' | 'Run' | 'Request', res: Response): Promise<RouvaError> {
  const raw = await res.text().catch((err: unknown) => {
    // A cancellation while reading the error body is the caller's abort, not a
    // gateway error — rethrow it so it isn't mistaken for a refusal and retried.
    if ((err as { name?: unknown } | null)?.name === 'AbortError') throw err
    return res.statusText
  })
  return new RouvaError(kind, res.status, res.headers, raw)
}
