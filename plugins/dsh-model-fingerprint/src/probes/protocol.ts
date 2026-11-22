/**
 * Protocol fingerprint (medium evidence; headers weak). Checks the response
 * envelope against what the vendor's own API emits — id prefixes, stop
 * reason vocabulary, usage structure, system_fingerprint, model echo,
 * streaming event order — and compares the structural shape with the
 * reference endpoint or baseline when they speak the same protocol.
 */
import { isNativeProtocol, VENDOR_SELF_NAMES, vendorOf } from '../models.ts'
import type { Evidence, GenerationResult, Protocol, ProtocolShape, Vendor } from '../types.ts'
import { idPattern, isRecord } from '../util.ts'
import { req, type Probe, type ProbeContext, type ProbeOutput } from './types.ts'

const PROMPT = 'Say hello in one short sentence.'
const MAX_TOKENS = 24

export interface Check { name: string; core: boolean; pass: boolean | undefined; detail: string }

/** Collapse consecutive duplicate stream labels. */
export function compressEvents(events: readonly string[]): string[] {
  const out: string[] = []
  for (const e of events) if (out[out.length - 1] !== e) out.push(e)
  return out
}

export function shapeOf(protocol: Protocol, nonStream: GenerationResult | undefined, stream: GenerationResult | undefined): ProtocolShape {
  const usage = nonStream?.usageRaw
  return {
    protocol,
    idPattern: idPattern(nonStream?.id),
    object: nonStream?.object,
    usageKeys: isRecord(usage) ? Object.keys(usage).sort() : [],
    stopReasons: [nonStream?.stopReason, stream?.stopReason].filter((s): s is string => typeof s === 'string'),
    streamEvents: compressEvents(stream?.stream?.events ?? []),
    systemFingerprintPattern: nonStream?.systemFingerprint === null ? 'null' : idPattern(nonStream?.systemFingerprint ?? undefined),
    modelEcho: nonStream?.model,
  }
}

const ANTHROPIC_STOPS = new Set(['end_turn', 'max_tokens', 'stop_sequence', 'tool_use', 'pause_turn', 'refusal', 'model_context_window_exceeded'])
const OPENAI_FINISH = new Set(['stop', 'length', 'tool_calls', 'content_filter', 'function_call'])
const GEMINI_FINISH = new Set(['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'LANGUAGE', 'OTHER', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'MALFORMED_FUNCTION_CALL', 'IMAGE_SAFETY', 'UNEXPECTED_TOOL_CALL', 'FINISH_REASON_UNSPECIFIED', 'TOO_MANY_TOOL_CALLS'])

function hasKeys(obj: unknown, keys: string[]): boolean {
  return isRecord(obj) && keys.every(k => k in obj)
}

function check(name: string, core: boolean, pass: boolean | undefined, detail: string): Check {
  return { name, core, pass, detail }
}

/** Vendor-native envelope rules. Returns [] when the protocol is not the vendor's own. */
export function nativeChecks(vendor: Vendor, protocol: Protocol, ns: GenerationResult, st: GenerationResult | undefined): Check[] {
  const ev = compressEvents(st?.stream?.events ?? [])
  const streamOk = st?.ok === true && ev.length > 0
  if (vendor === 'anthropic' && protocol === 'anthropic-messages') {
    return [
      check('id_prefix', true, /^msg_[A-Za-z0-9]{20,}$/.test(ns.id ?? ''), `id 形如 msg_…：${idPattern(ns.id) ?? '缺失'}`),
      check('type', true, ns.object === 'message', `type=${ns.object ?? '缺失'}`),
      check('stop_reason_enum', true, ns.stopReason !== undefined && ANTHROPIC_STOPS.has(ns.stopReason), `stop_reason=${ns.stopReason ?? '缺失'}`),
      check('usage_keys', true, hasKeys(ns.usageRaw, ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']), `usage 字段：${isRecord(ns.usageRaw) ? Object.keys(ns.usageRaw).join(',') : '缺失'}`),
      check('stream_sequence', true, streamOk ? ev[0] === 'message_start' && ev.includes('content_block_start') && ev.includes('content_block_delta') && ev.includes('content_block_stop') && ev.includes('message_delta') && ev[ev.length - 1] === 'message_stop' : undefined, `流式事件：${ev.join(' → ') || '无'}`),
    ]
  }
  if (vendor === 'openai' && protocol === 'openai-completions') {
    const u = ns.usageRaw
    const totalOk = isRecord(u) && typeof u.total_tokens === 'number' && typeof u.prompt_tokens === 'number' && typeof u.completion_tokens === 'number' && u.total_tokens === u.prompt_tokens + u.completion_tokens
    return [
      check('id_prefix', true, /^chatcmpl-[A-Za-z0-9]{10,}$/.test(ns.id ?? ''), `id 形如 chatcmpl-…：${idPattern(ns.id) ?? '缺失'}`),
      check('object', true, ns.object === 'chat.completion', `object=${ns.object ?? '缺失'}`),
      check('finish_reason_enum', true, ns.stopReason !== undefined && OPENAI_FINISH.has(ns.stopReason), `finish_reason=${ns.stopReason ?? '缺失'}`),
      check('usage_keys', true, totalOk && hasKeys(u, ['prompt_tokens_details', 'completion_tokens_details']), `usage 字段：${isRecord(u) ? Object.keys(u).join(',') : '缺失'}`),
      check('stream_sequence', true, streamOk ? ev.every(e => e.startsWith('chat.completion.chunk') || e === '[DONE]') && (ev[0]?.includes(':role') ?? false) && ev[ev.length - 1] === '[DONE]' && ev.some(e => e.includes(':usage')) : undefined, `流式事件：${ev.join(' → ') || '无'}`),
      check('system_fingerprint', false, ns.systemFingerprint === null || /^fp_[0-9a-f]{6,}$/.test(ns.systemFingerprint ?? '') ? true : ns.systemFingerprint === undefined ? undefined : false, `system_fingerprint：${ns.systemFingerprint === null ? 'null' : idPattern(ns.systemFingerprint ?? undefined) ?? '缺失'}`),
    ]
  }
  if (vendor === 'openai' && protocol === 'openai-responses') {
    return [
      check('id_prefix', true, /^resp_[0-9A-Za-z]{16,}$/.test(ns.id ?? ''), `id 形如 resp_…：${idPattern(ns.id) ?? '缺失'}`),
      check('object', true, ns.object === 'response', `object=${ns.object ?? '缺失'}`),
      check('status_enum', true, ns.stopReason !== undefined && /^(completed|incomplete)/.test(ns.stopReason), `status=${ns.stopReason ?? '缺失'}`),
      check('usage_keys', true, hasKeys(ns.usageRaw, ['input_tokens', 'output_tokens', 'total_tokens', 'input_tokens_details', 'output_tokens_details']), `usage 字段：${isRecord(ns.usageRaw) ? Object.keys(ns.usageRaw).join(',') : '缺失'}`),
      check('stream_sequence', true, streamOk ? ev[0] === 'response.created' && ev.includes('response.output_text.delta') && ev[ev.length - 1] === 'response.completed' : undefined, `流式事件：${ev.join(' → ') || '无'}`),
    ]
  }
  if (vendor === 'google' && protocol === 'google-generative-ai') {
    return [
      check('response_id', true, typeof ns.id === 'string' && ns.id.length > 0, `responseId：${ns.id ? '存在' : '缺失'}`),
      check('model_version', true, typeof ns.model === 'string' && ns.model.length > 0, `modelVersion：${ns.model ?? '缺失'}`),
      check('finish_reason_enum', true, ns.stopReason !== undefined && GEMINI_FINISH.has(ns.stopReason), `finishReason=${ns.stopReason ?? '缺失'}`),
      check('usage_keys', true, hasKeys(ns.usageRaw, ['promptTokenCount', 'totalTokenCount']), `usageMetadata 字段：${isRecord(ns.usageRaw) ? Object.keys(ns.usageRaw).join(',') : '缺失'}`),
      check('stream_sequence', true, streamOk ? ev.every(e => e.startsWith('chunk:candidates')) && (ev[ev.length - 1]?.includes(':usage') ?? false) : undefined, `流式分块：${ev.join(' → ') || '无'}`),
    ]
  }
  if (vendor === 'deepseek' && protocol === 'openai-completions') {
    return [
      check('id_uuid', true, idPattern(ns.id) === 'uuid', `id：${idPattern(ns.id) ?? '缺失'}`),
      check('object', true, ns.object === 'chat.completion', `object=${ns.object ?? '缺失'}`),
      check('finish_reason_enum', true, ns.stopReason !== undefined && OPENAI_FINISH.has(ns.stopReason), `finish_reason=${ns.stopReason ?? '缺失'}`),
      check('usage_cache_keys', true, hasKeys(ns.usageRaw, ['prompt_cache_hit_tokens', 'prompt_cache_miss_tokens']), `usage 字段：${isRecord(ns.usageRaw) ? Object.keys(ns.usageRaw).join(',') : '缺失'}`),
      check('stream_sequence', true, streamOk ? ev[ev.length - 1] === '[DONE]' : undefined, `流式事件：${ev.join(' → ') || '无'}`),
    ]
  }
  return []
}

/** Compare two shapes field by field. */
export function compareShapes(a: ProtocolShape, b: ProtocolShape): { same: string[]; differ: string[] } {
  const same: string[] = []
  const differ: string[] = []
  const eq = (name: string, x: unknown, y: unknown): void => { (JSON.stringify(x) === JSON.stringify(y) ? same : differ).push(name) }
  eq('idPattern', a.idPattern, b.idPattern)
  eq('object', a.object, b.object)
  eq('usageKeys', a.usageKeys, b.usageKeys)
  if (a.streamEvents.length > 0 && b.streamEvents.length > 0) eq('streamEvents', [...new Set(a.streamEvents)].sort(), [...new Set(b.streamEvents)].sort())
  if (a.systemFingerprintPattern !== undefined || b.systemFingerprintPattern !== undefined) eq('systemFingerprint', a.systemFingerprintPattern, b.systemFingerprintPattern)
  return { same, differ }
}

const VENDOR_HEADERS: Partial<Record<Vendor, RegExp>> = {
  openai: /^(openai-processing-ms|openai-version|openai-organization|openai-project)$/,
  anthropic: /^(anthropic-ratelimit-.*|anthropic-organization-id)$/,
}

export function headerEvidence(vendor: Vendor, headers: Record<string, string>): Evidence {
  const names = Object.keys(headers)
  const own = VENDOR_HEADERS[vendor]
  const ownHits = own ? names.filter(n => own.test(n)) : []
  const foreign = Object.entries(VENDOR_HEADERS).filter(([v]) => v !== vendor).flatMap(([v, re]) => names.filter(n => (re as RegExp).test(n)).map(n => `${n}(${v})`))
  const requestId = headers['request-id'] ?? headers['x-request-id']
  const raw = { headers }
  if (foreign.length > 0 && ownHits.length === 0) {
    return { probe: 'protocol.headers', strength: 'weak', result: 'mismatch', category: 'substitution', detail: `响应头出现其他厂商特征：${foreign.join(', ')}`, raw }
  }
  if (ownHits.length > 0) {
    return { probe: 'protocol.headers', strength: 'weak', result: 'match', category: 'substitution', detail: `响应头含 ${vendor} 特征：${ownHits.join(', ')}${requestId ? `；request id 格式 ${requestId}` : ''}（可被中转站透传或伪造）`, raw }
  }
  return { probe: 'protocol.headers', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: `响应头没有厂商特征（中转站通常会剥离），仅记录存在性与格式。`, raw }
}

export function modelEchoEvidence(claimed: string, echo: string | undefined): Evidence | undefined {
  if (!echo) return undefined
  const claimedVendor = vendorOf(claimed)
  const echoVendor = vendorOf(echo)
  const mentionsOther = Object.entries(VENDOR_SELF_NAMES).filter(([v]) => v !== claimedVendor).find(([, re]) => re.test(echo))
  if (echoVendor !== 'unknown' && claimedVendor !== 'unknown' && echoVendor !== claimedVendor) {
    return { probe: 'protocol.model_echo', strength: 'medium', result: 'mismatch', category: 'substitution', detail: `响应回显的模型名为 ${echo}，属于 ${echoVendor}，与声称的 ${claimed} 不符。`, raw: { echo } }
  }
  if (mentionsOther && claimedVendor !== 'unknown') {
    return { probe: 'protocol.model_echo', strength: 'medium', result: 'mismatch', category: 'substitution', detail: `响应回显的模型名 ${echo} 含有其他厂商名称（${mentionsOther[0]}）。`, raw: { echo } }
  }
  const base = claimed.toLowerCase().replace(/^.*\//, '')
  const e = echo.toLowerCase().replace(/^(models\/|.*\/)/, '')
  const consistent = e === base || e.startsWith(base) || base.startsWith(e)
  return { probe: 'protocol.model_echo', strength: 'weak', result: consistent ? 'match' : 'inconclusive', category: 'substitution', detail: consistent ? `模型回显 ${echo} 与声称一致（回显可被中转站改写，仅作弱证据）。` : `模型回显 ${echo} 与请求的 ${claimed} 不同（可能是快照名或被改写）。`, raw: { echo } }
}

async function sample(ctx: ProbeContext, which: 'target' | 'reference'): Promise<{ ns: GenerationResult; st: GenerationResult }> {
  const ep = which === 'target' ? ctx.target : ctx.reference!
  const ns = await ep.generate('protocol', { user: PROMPT, maxTokens: MAX_TOKENS }, ctx.signal)
  const st = await ep.generate('protocol', { user: PROMPT, maxTokens: MAX_TOKENS, stream: true }, ctx.signal)
  return { ns, st }
}

export const protocolProbe: Probe = {
  id: 'protocol',
  title: '协议指纹',

  plan(ctx) {
    const plan = [req('target', 'protocol', 20, MAX_TOKENS), req('target', 'protocol', 20, MAX_TOKENS)]
    if (ctx.mode === 'verify' && ctx.hasReference && ctx.referenceProtocol === ctx.targetProtocol) {
      plan.push(req('reference', 'protocol', 20, MAX_TOKENS), req('reference', 'protocol', 20, MAX_TOKENS))
    }
    return plan
  },

  async run(ctx: ProbeContext): Promise<ProbeOutput> {
    const { ns, st } = await sample(ctx, 'target')
    const protocol = ctx.target.info.protocol
    const shape = shapeOf(protocol, ns.ok ? ns : undefined, st.ok ? st : undefined)
    if (ctx.mode === 'record') {
      ctx.record.protocolShape = shape
      return { evidence: [], summary: `已记录协议形态（${shape.idPattern ?? '无 id'}，${shape.streamEvents.length} 类流式事件）`, data: { shape } }
    }
    const evidence: Evidence[] = []
    if (!ns.ok) {
      evidence.push({ probe: 'protocol.envelope', strength: 'medium', result: 'inconclusive', category: 'substitution', detail: `请求失败：HTTP ${ns.status} ${ns.error?.message ?? ''}`, raw: { status: ns.status, error: ns.error } })
      return { evidence, summary: '请求失败', data: { shape } }
    }
    const native = isNativeProtocol(ctx.vendor, protocol) || (ctx.vendor === 'deepseek' && protocol === 'openai-completions')
    const checks = nativeChecks(ctx.vendor, protocol, ns, st)
    const core = checks.filter(c => c.core && c.pass !== undefined)
    const failed = core.filter(c => c.pass === false)
    const raw = { checks, shape, body: ns.body }
    if (!native || checks.length === 0) {
      evidence.push({ probe: 'protocol.envelope', strength: 'medium', result: 'inconclusive', category: 'substitution', detail: `${protocol} 不是 ${ctx.vendor} 的原生协议，无法套用官方响应规则（仅比较参考端点/基线形态）。`, raw })
    } else if (failed.length >= 2) {
      evidence.push({ probe: 'protocol.envelope', strength: 'medium', result: 'mismatch', category: 'substitution', detail: `响应结构与 ${ctx.vendor} 官方 ${protocol} 不符：${failed.map(c => `${c.name}（${c.detail}）`).join('；')}`, raw })
    } else if (failed.length === 0 && core.length >= 3) {
      evidence.push({ probe: 'protocol.envelope', strength: 'medium', result: 'match', category: 'substitution', detail: `${core.length} 项核心结构检查均符合 ${ctx.vendor} 官方 ${protocol}。`, raw })
    } else {
      evidence.push({ probe: 'protocol.envelope', strength: 'medium', result: 'inconclusive', category: 'substitution', detail: `结构检查 ${core.length - failed.length}/${core.length} 通过${failed.length ? `；不符：${failed.map(c => c.detail).join('；')}` : ''}`, raw })
    }

    // Shape comparison with the official reference (same protocol) or baseline.
    let comparedWith: ProtocolShape | undefined
    let label = ''
    if (ctx.reference && ctx.reference.info.protocol === protocol) {
      const r = await sample(ctx, 'reference')
      if (r.ns.ok) { comparedWith = shapeOf(protocol, r.ns, r.st.ok ? r.st : undefined); label = '官方参考端点' }
    } else if (ctx.baseline?.protocolShape && ctx.baseline.protocolShape.protocol === protocol) {
      comparedWith = ctx.baseline.protocolShape
      label = `基线 ${ctx.baseline.id}`
    }
    if (comparedWith) {
      const { same, differ } = compareShapes(shape, comparedWith)
      const detailRaw = { target: shape, expected: comparedWith }
      if (differ.length >= 2) evidence.push({ probe: 'protocol.shape', strength: 'medium', result: 'mismatch', category: 'substitution', detail: `与${label}的响应形态不同：${differ.join(', ')}`, raw: detailRaw })
      else if (differ.length === 0) evidence.push({ probe: 'protocol.shape', strength: 'medium', result: 'match', category: 'substitution', detail: `与${label}的响应形态一致（${same.join(', ')}）。`, raw: detailRaw })
      else evidence.push({ probe: 'protocol.shape', strength: 'weak', result: 'inconclusive', category: 'substitution', detail: `与${label}有 1 处差异：${differ.join(', ')}`, raw: detailRaw })
    }

    const echo = modelEchoEvidence(ctx.claimedModel, ns.model)
    if (echo) evidence.push(echo)
    evidence.push(headerEvidence(ctx.vendor, ns.headers))
    const summary = `${checks.length ? `${core.length - failed.length}/${core.length} 项结构检查通过` : '非原生协议'}${comparedWith ? `；与${label}形态比较完成` : ''}`
    return { evidence, summary, data: { shape, checks } }
  },
}
