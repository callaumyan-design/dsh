/** Shared types for the model-fingerprint plugin. */

/** Wire protocols, spelled exactly as DSH stores them in `cordis.patch.yml` (`llm-pi-ai` `api`). */
export const PROTOCOLS = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'] as const
export type Protocol = typeof PROTOCOLS[number]

/** Probe ids. `signature` and `context_limit` are expensive and never run unless listed explicitly. */
export const PROBE_IDS = ['tokenizer', 'protocol', 'params', 'behavior', 'performance', 'signature', 'context_limit'] as const
export type ProbeId = typeof PROBE_IDS[number]
export const DEFAULT_PROBES: readonly ProbeId[] = ['tokenizer', 'protocol', 'params', 'behavior', 'performance']
export const EXPENSIVE_PROBES: readonly ProbeId[] = ['signature', 'context_limit']

export type Vendor = 'anthropic' | 'openai' | 'google' | 'deepseek' | 'qwen' | 'zhipu' | 'moonshot' | 'xai' | 'meta' | 'mistral' | 'unknown'

export type Strength = 'strong' | 'medium' | 'weak'
export type EvidenceResult = 'match' | 'mismatch' | 'inconclusive'
/** Which of the three problem classes a piece of evidence speaks to. */
export type EvidenceCategory = 'substitution' | 'injection' | 'parameters'

/** One piece of evidence. The five first fields are the contract; `category` groups the report. */
export interface Evidence {
  probe: string
  strength: Strength
  result: EvidenceResult
  detail: string
  raw: unknown
  category?: EvidenceCategory
}

export type Verdict = 'consistent' | 'inconsistent' | 'suspicious' | 'not-run'

/** Resolved endpoint description that is safe to print (no secret). */
export interface EndpointInfo {
  role: 'target' | 'reference'
  baseURL: string
  origin: string
  protocol: Protocol
  model: string
  /** Where the key came from, e.g. `credentials:file RELAY_KEY`; never the value. */
  keySource: string
  /** Whether the origin is on the official-host allowlist. */
  official: boolean
  providerId?: string
}

/** Budget limits; every field is a hard ceiling for one tool call. */
export interface BudgetLimits {
  maxRequests: number
  maxInputTokens: number
  maxOutputTokens: number
  maxCostUsd: number
  /** Optional price override (USD per 1M tokens) used for the cost estimate. */
  inputPricePerMTok?: number
  outputPricePerMTok?: number
}

export interface UsageNumbers {
  inputTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

export interface ToolCallInfo {
  id?: string
  /** Secondary item id (Responses `fc_…`). */
  itemId?: string
  name?: string
  /** Arguments exactly as the wire carried them (string for OpenAI, object for Anthropic/Gemini). */
  arguments?: unknown
}

/** A thinking/reasoning artifact that can be replayed to the official API. */
export interface SignatureArtifact {
  kind: 'anthropic-thinking' | 'openai-encrypted-reasoning' | 'gemini-thought-signature'
  /** The opaque signature/encrypted payload. */
  value: string
  /** Protocol-native item(s) needed to replay it, verbatim from the response. */
  items: unknown[]
}

/** Normalized view of one generation (non-stream or stream). */
export interface GenerationResult {
  ok: boolean
  status: number
  /** Header descriptors: presence + format only. */
  headers: Record<string, string>
  latencyMs: number
  id?: string
  object?: string
  model?: string
  text: string
  /** Native stop/finish reason. */
  stopReason?: string
  /** Normalized stop reason. */
  stop: 'stop' | 'length' | 'tool' | 'stop_sequence' | 'filter' | 'other' | 'unknown'
  stopSequence?: string
  usage: UsageNumbers
  /** Usage object exactly as received. */
  usageRaw?: unknown
  toolCalls: ToolCallInfo[]
  systemFingerprint?: string | null
  logprobs?: { token: string; logprob: number; bytes?: number[] | null }[] | null
  signatures: SignatureArtifact[]
  /** Response body (redacted, may be truncated by callers). */
  body?: unknown
  error?: { type?: string; code?: string; message?: string }
  stream?: StreamStats
}

export interface StreamStats {
  /** SSE event names (`event:` field, or `type`/`object` when absent), in order. */
  events: string[]
  ttftMs?: number
  totalMs: number
  /** Time from first to last content delta. */
  generationMs?: number
  sawDone: boolean
  chunkCount: number
}

/** Per-probe outcome stored in the report. */
export interface ProbeOutcome {
  id: ProbeId
  status: 'ok' | 'skipped' | 'error' | 'budget'
  summary: string
  data?: unknown
}

/** Baseline written by `model_fingerprint_record`. */
export interface Baseline {
  schemaVersion: 1
  id: string
  model: string
  protocol: Protocol
  vendor: Vendor
  recordedAt: string
  endpointOrigin: string
  pluginVersion: string
  corpusVersion: string
  samples: number
  tokenizer?: {
    minimalInputTokens: number[]
    deltas: Record<string, number>
  }
  protocolShape?: ProtocolShape
  params?: Record<string, unknown>
  behavior?: Record<string, string[]>
  performance?: { ttftMs: number[]; tokensPerSecond: number[] }
  notes?: string[]
}

/** Structural fingerprint of a protocol response, comparable across endpoints of the same protocol. */
export interface ProtocolShape {
  protocol: Protocol
  idPattern?: string
  object?: string
  usageKeys: string[]
  stopReasons: string[]
  streamEvents: string[]
  systemFingerprintPattern?: string
  modelEcho?: string
}
