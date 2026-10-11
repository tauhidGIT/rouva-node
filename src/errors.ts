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
   * `"unbounded"` (a capped key can't send input whose cost can't be bounded).
   * Not every refusal carries it yet — a 429 with `retryAfter` and no
   * `refusal` can still be a Rouva cap or rate refusal; read `error`.
   */
  readonly refusal?: string
  /** Seconds to wait before retrying, from `Retry-After`, when present. */
  readonly retryAfter?: number
  /** The gateway's error message (`error` field), when the body is JSON. */
  readonly error?: string
  /** The parsed JSON body, or the raw text when it isn't JSON. */
  readonly body: unknown

  constructor(kind: 'Gateway' | 'Run', status: number, headers: Headers, rawBody: string) {
    super(`[Rouva] ${kind} error ${status}: ${rawBody}`)
    this.name = 'RouvaError'
    this.status = status
    this.refusal = headers.get('x-rouva-refusal') ?? undefined
    const retry = Number(headers.get('retry-after'))
    this.retryAfter = headers.get('retry-after') !== null && Number.isFinite(retry) ? retry : undefined
    let parsed: unknown = rawBody
    try { parsed = JSON.parse(rawBody) } catch { /* plain text */ }
    this.body = parsed
    const e = (parsed as { error?: unknown } | null)?.error
    this.error = typeof e === 'string' ? e : undefined
  }
}

export async function toRouvaError(kind: 'Gateway' | 'Run', res: Response): Promise<RouvaError> {
  const raw = await res.text().catch(() => res.statusText)
  return new RouvaError(kind, res.status, res.headers, raw)
}
