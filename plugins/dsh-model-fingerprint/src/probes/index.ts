/** Probe registry, in execution order. */
import type { ProbeId } from '../types.ts'
import { behaviorProbe } from './behavior.ts'
import { contextProbe } from './context.ts'
import { paramsProbe } from './params.ts'
import { performanceProbe } from './performance.ts'
import { protocolProbe } from './protocol.ts'
import { signatureProbe } from './signature.ts'
import { tokenizerProbe } from './tokenizer.ts'
import type { Probe } from './types.ts'

export const PROBES: Record<ProbeId, Probe> = {
  tokenizer: tokenizerProbe,
  protocol: protocolProbe,
  params: paramsProbe,
  signature: signatureProbe,
  behavior: behaviorProbe,
  performance: performanceProbe,
  context_limit: contextProbe,
}

/** Probes a baseline recording runs (expensive/comparison-only probes are excluded). */
export const RECORD_PROBES: readonly ProbeId[] = ['tokenizer', 'protocol', 'params', 'behavior', 'performance']

export const EXECUTION_ORDER: readonly ProbeId[] = ['tokenizer', 'protocol', 'params', 'signature', 'behavior', 'performance', 'context_limit']

export type { Probe, ProbeContext, PlanContext, ProbeOutput } from './types.ts'
