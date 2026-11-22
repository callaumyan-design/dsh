/** Probe contract. */
import type { PlannedRequest } from '../budget.ts'
import type { Endpoint } from '../endpoint.ts'
import type { Baseline, Evidence, ProbeId, Protocol, Vendor } from '../types.ts'

export interface PlanContext {
  claimedModel: string
  vendor: Vendor
  targetProtocol: Protocol
  referenceProtocol?: Protocol
  hasReference: boolean
  baseline?: Baseline
  samples: number
  mode: 'verify' | 'record'
  contextTokens?: number
}

export interface ProbeContext extends PlanContext {
  target: Endpoint
  reference?: Endpoint
  signal?: AbortSignal
  /** Measurements a record run persists into the baseline. */
  record: Partial<Baseline>
  /** Anthropic thinking request style for the signature probe. */
  thinkingStyle: 'enabled' | 'adaptive'
}

export interface ProbeOutput {
  evidence: Evidence[]
  summary: string
  data?: unknown
}

export interface Probe {
  id: ProbeId
  title: string
  plan(ctx: PlanContext): PlannedRequest[]
  run(ctx: ProbeContext): Promise<ProbeOutput>
}

export function req(endpoint: 'target' | 'reference', probe: string, inputTokens: number, outputTokens: number, free = false): PlannedRequest {
  return { endpoint, probe, inputTokens, outputTokens, ...free ? { free } : {} }
}

/** Repeat a planned request n times. */
export function times(n: number, make: () => PlannedRequest): PlannedRequest[] {
  return Array.from({ length: n }, make)
}
