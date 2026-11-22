/** Secret redaction for everything the plugin prints, stores, or returns. */

/** Mask one secret for display: never more than 4 leading + 2 trailing characters, only for long values. */
export function maskSecret(value: string): string {
  if (value.length >= 20) return `${value.slice(0, 4)}…${value.slice(-2)}`
  return '****'
}

const GENERIC_PATTERNS: RegExp[] = [
  /sk-ant-[A-Za-z0-9_-]{8,}/g,
  /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{12,}/g,
  /AIza[0-9A-Za-z_-]{20,}/g,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abpr]-[A-Za-z0-9-]{10,}/g,
  // key=… query parameters and JSON/header-ish "x-api-key: …" pairs.
  /([?&](?:key|api_key|apikey|access_token)=)[^&\s"']+/gi,
  /("?(?:x-api-key|x-goog-api-key|api-key|authorization|apiKey|api_key)"?\s*[:=]\s*"?)([^"\s,}]{6,})/gi,
]

/**
 * Redactor that knows the concrete secrets resolved for this run (exact
 * replacement) and also scrubs generic key shapes, so a key echoed back by a
 * relay in an error message is masked too.
 */
export class Redactor {
  private readonly secrets = new Set<string>()

  add(secret: string | undefined): void {
    if (secret !== undefined && secret.length >= 4) this.secrets.add(secret)
  }

  redactString(input: string): string {
    let out = input
    // Longest first so a key that contains another key is masked as a whole.
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length)) {
      if (out.includes(secret)) out = out.split(secret).join(maskSecret(secret))
    }
    for (const pattern of GENERIC_PATTERNS) {
      out = out.replace(pattern, (match: string, prefix?: string, value?: string) => {
        if (typeof value === 'string' && typeof prefix === 'string') return `${prefix}${maskSecret(value)}`
        if (typeof prefix === 'string' && /[?&]/.test(prefix)) return `${prefix}****`
        return maskSecret(match)
      })
    }
    return out
  }

  /** Deep-redact a JSON-like value; non-JSON values become strings or null. */
  redact<T>(value: T): T {
    return this.walk(value, 0) as T
  }

  private walk(value: unknown, depth: number): unknown {
    if (depth > 64) return '[depth limit]'
    if (typeof value === 'string') return this.redactString(value)
    if (typeof value === 'number') return Number.isFinite(value) ? value : null
    if (typeof value === 'boolean' || value === null) return value
    if (value === undefined) return undefined
    if (Array.isArray(value)) return value.map(item => this.walk(item, depth + 1) ?? null)
    if (typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (/^(authorization|x-api-key|x-goog-api-key|api-key|apiKey|api_key|cookie|set-cookie)$/i.test(key)) {
          out[key] = typeof child === 'string' ? maskSecret(child) : '****'
          continue
        }
        const walked = this.walk(child, depth + 1)
        if (walked !== undefined) out[key] = walked
      }
      return out
    }
    return String(value)
  }
}

/**
 * Make a value lossless JSON: drop undefined, replace non-finite numbers with
 * null, stringify bigint. Tool canonical values must satisfy this.
 */
export function toJsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, v: unknown) => {
    if (typeof v === 'number' && !Number.isFinite(v)) return null
    if (typeof v === 'bigint') return v.toString()
    return v
  }) ?? 'null')
}

/** Truncate long strings inside a JSON-like value (for model-facing summaries). */
export function truncateDeep(value: unknown, maxString: number, depth = 0): unknown {
  if (depth > 32) return '[depth limit]'
  if (typeof value === 'string') return value.length > maxString ? `${value.slice(0, maxString)}…[+${value.length - maxString} chars]` : value
  if (Array.isArray(value)) {
    const items = value.slice(0, 40).map(item => truncateDeep(item, maxString, depth + 1))
    if (value.length > 40) items.push(`…[+${value.length - 40} items]`)
    return items
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = truncateDeep(v, maxString, depth + 1)
    return out
  }
  return value
}
