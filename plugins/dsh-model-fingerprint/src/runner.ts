/** Orchestration of verify / record / list. Independent of Cordis so it can be tested directly. */
import { join } from 'node:path'
import { BudgetExceededError, BudgetTracker, DEFAULT_BUDGET, estimate, exceeds, type BudgetEstimate } from './budget.ts'
import { Endpoint } from './endpoint.ts'
import type { TransportOptions } from './http.ts'
import { vendorOf } from './models.ts'
import { EXECUTION_ORDER, PROBES, RECORD_PROBES, type PlanContext, type ProbeContext } from './probes/index.ts'
import { Redactor, toJsonValue } from './redact.ts'
import { BASE_LIMITATIONS, renderMarkdown, type VerifyReport } from './report.ts'
import { assertKeySeparation, resolveDshHome, resolveReference, resolveTarget, ResolveError, type EndpointArgs, type ResolvedEndpoint, type ServiceSource } from './resolve.ts'
import { score, VERDICT_LABEL } from './scoring.ts'
import { findBaseline, newBaselineId, readBaselines, reportBase, saveBaseline, saveReport, summarizeBaseline, type BaselineSummary } from './storage.ts'
import { CORPUS_VERSION } from './tokenizer.ts'
import { DEFAULT_PROBES, EXPENSIVE_PROBES, PROBE_IDS, type Baseline, type BudgetLimits, type Evidence, type ProbeId, type ProbeOutcome } from './types.ts'
import { AbortedError, errorMessage } from './util.ts'

declare const __PLUGIN_VERSION__: string
export const PLUGIN_VERSION: string = typeof __PLUGIN_VERSION__ === 'string' ? __PLUGIN_VERSION__ : '0.0.0-dev'

/** Runtime settings (the plugin Config after defaults). */
export interface RunnerSettings {
  dataDir?: string
  extraOfficialHosts: string[]
  allowInsecureHttp: boolean
  requestTimeoutMs: number
  maxRetries: number
  minIntervalMs: number
  maxBackoffMs: number
  defaultSamples: number
  defaultBudget: BudgetLimits
  saveReports: boolean
  thinkingStyle: 'enabled' | 'adaptive'
  profile?: string
}

export const DEFAULT_SETTINGS: RunnerSettings = {
  extraOfficialHosts: [],
  allowInsecureHttp: false,
  requestTimeoutMs: 60_000,
  maxRetries: 3,
  minIntervalMs: 250,
  maxBackoffMs: 30_000,
  defaultSamples: 3,
  defaultBudget: DEFAULT_BUDGET,
  saveReports: true,
  thinkingStyle: 'enabled',
}

export interface RunnerDeps {
  services: ServiceSource
  settings: RunnerSettings
  signal?: AbortSignal
  fetchImpl?: typeof fetch
  env?: Record<string, string | undefined>
  now?: () => Date
}

export interface VerifyArgs {
  target: EndpointArgs
  claimedModel?: string
  reference?: EndpointArgs
  probes?: string[]
  budget?: Partial<BudgetLimits>
  samples?: number
  /** Baseline id, `latest` (default) or `none`. */
  baseline?: string
  contextTokens?: number
  dryRun?: boolean
}

export interface RecordArgs {
  endpoint: EndpointArgs
  model?: string
  probes?: string[]
  budget?: Partial<BudgetLimits>
  samples?: number
  dryRun?: boolean
}

export interface ToolResult { markdown: string; report: unknown }

export class UsageError extends Error {
  constructor(message: string) { super(message); this.name = 'UsageError' }
}

export function dataDirOf(deps: RunnerDeps): string {
  return deps.settings.dataDir ?? join(resolveDshHome(deps.services, resolveOptions(deps)), 'data', 'model-fingerprint')
}

function resolveOptions(deps: RunnerDeps): Parameters<typeof resolveTarget>[3] {
  return {
    extraOfficialHosts: deps.settings.extraOfficialHosts,
    allowInsecureHttp: deps.settings.allowInsecureHttp,
    ...deps.settings.profile ? { profile: deps.settings.profile } : {},
    ...deps.env ? { env: deps.env } : {},
  }
}

function transportOptions(s: RunnerSettings): TransportOptions {
  return { timeoutMs: s.requestTimeoutMs, maxRetries: s.maxRetries, minIntervalMs: s.minIntervalMs, maxBackoffMs: s.maxBackoffMs, maxIntervalMs: 15_000 }
}

export function parseProbes(requested: string[] | undefined, allowed: readonly ProbeId[] = PROBE_IDS): ProbeId[] {
  if (requested === undefined || requested.length === 0) return [...DEFAULT_PROBES].filter(p => allowed.includes(p))
  const unknown = requested.filter(p => !(allowed as readonly string[]).includes(p))
  if (unknown.length > 0) throw new UsageError(`unknown probe(s): ${unknown.join(', ')}; allowed: ${allowed.join(', ')}`)
  return EXECUTION_ORDER.filter(p => requested.includes(p))
}

export function parseSamples(samples: number | undefined, fallback: number): number {
  const n = samples ?? fallback
  if (!Number.isInteger(n) || n < 1 || n > 10) throw new UsageError('samples must be an integer between 1 and 10')
  return n
}

export function mergeBudget(base: BudgetLimits, override: Partial<BudgetLimits> | undefined): BudgetLimits {
  const merged: BudgetLimits = { ...base, ...Object.fromEntries(Object.entries(override ?? {}).filter(([, v]) => v !== undefined)) }
  for (const key of ['maxRequests', 'maxInputTokens', 'maxOutputTokens', 'maxCostUsd'] as const) {
    if (!Number.isFinite(merged[key]) || merged[key] < 0) throw new UsageError(`budget.${key} must be a non-negative number`)
  }
  return merged
}

function makeEndpoint(r: ResolvedEndpoint, deps: RunnerDeps, budget: BudgetTracker, redactor: Redactor): Endpoint {
  return new Endpoint(r.info, r.secret, r.headers, r.adapterOptions, transportOptions(deps.settings), budget, redactor, deps.fetchImpl)
}

/** model_fingerprint_verify */
export async function runVerify(args: VerifyArgs, deps: RunnerDeps): Promise<ToolResult> {
  const now = deps.now ?? (() => new Date())
  const claimedModel = args.claimedModel ?? args.target.model
  if (!claimedModel) throw new UsageError('claimedModel (or target.model) is required')
  const probes = parseProbes(args.probes)
  const samples = parseSamples(args.samples, deps.settings.defaultSamples)
  const limits = mergeBudget(deps.settings.defaultBudget, args.budget)
  const redactor = new Redactor()
  const opts = resolveOptions(deps)
  const warnings: string[] = []

  const target = await resolveTarget(deps.services, args.target, claimedModel, opts)
  redactor.add(target.secret)
  warnings.push(...target.warnings)
  let reference: ResolvedEndpoint | undefined
  if (args.reference !== undefined) {
    reference = await resolveReference(deps.services, args.reference, claimedModel, opts)
    redactor.add(reference.secret)
  }
  assertKeySeparation(target, reference)
  if (target.info.official) warnings.push('目标端点本身就是官方域名，验证的是官方 API。')

  const vendor = vendorOf(claimedModel)
  const dataDir = dataDirOf(deps)
  let baseline: Baseline | undefined
  if ((args.baseline ?? 'latest') !== 'none') {
    const found = await findBaseline(dataDir, args.baseline ?? 'latest', claimedModel, target.info.protocol)
    if (found) baseline = found.baseline
    else if (args.baseline && args.baseline !== 'latest') throw new UsageError(`baseline ${args.baseline} not found (model_fingerprint_list shows recorded baselines)`)
  }
  if (baseline && baseline.corpusVersion !== CORPUS_VERSION) warnings.push(`基线 ${baseline.id} 的语料版本 ${baseline.corpusVersion} 与当前 ${CORPUS_VERSION} 不同，分词器部分不使用该基线。`)
  for (const p of probes) if (EXPENSIVE_PROBES.includes(p)) warnings.push(`已显式开启高费用探针 ${p}。`)
  if (probes.includes('signature') && !reference) warnings.push('signature 探针需要 reference（官方端点与 key），本次将跳过。')

  const planCtx: PlanContext = {
    claimedModel, vendor, targetProtocol: target.info.protocol, ...reference ? { referenceProtocol: reference.info.protocol } : {},
    hasReference: reference !== undefined, ...baseline ? { baseline } : {}, samples, mode: 'verify',
    ...args.contextTokens !== undefined ? { contextTokens: args.contextTokens } : {},
  }
  const plan = probes.flatMap(p => PROBES[p].plan(planCtx))
  const models = { target: target.info.model, ...reference ? { reference: reference.info.model } : {} }
  const est = estimate(plan, models, limits)
  const over = exceeds(est, limits)

  const report: VerifyReport = {
    schemaVersion: 1, kind: 'verify', generatedAt: now().toISOString(), pluginVersion: PLUGIN_VERSION,
    claimedModel, vendor, target: target.info, ...reference ? { reference: reference.info } : {},
    ...baseline ? { baseline: { id: baseline.id, recordedAt: baseline.recordedAt, model: baseline.model, protocol: baseline.protocol } } : {},
    probesRequested: probes, samples,
    verdict: 'not-run', verdictLabel: VERDICT_LABEL['not-run'], confidence: 0, confidenceLabel: '-', reasons: [],
    evidence: [], probes: [],
    budget: { limits, estimate: est, actual: { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 } },
    calls: [], rateLimited: { target: 0, reference: 0 },
    limitations: [...BASE_LIMITATIONS], warnings,
  }

  if (over || args.dryRun) {
    report.reasons.push(over ? `已中止，未发送任何请求：${over}。可调大 budget 或减少 probes/samples。` : 'dryRun：只做了请求数、token 与费用估算，未发送任何请求。')
    return finish(report, redactor, deps, dataDir, false)
  }

  const tracker = new BudgetTracker(limits, models)
  const targetEp = makeEndpoint(target, deps, tracker, redactor)
  const referenceEp = reference ? makeEndpoint(reference, deps, tracker, redactor) : undefined
  const ctx: ProbeContext = { ...planCtx, target: targetEp, ...referenceEp ? { reference: referenceEp } : {}, ...deps.signal ? { signal: deps.signal } : {}, record: {}, thinkingStyle: deps.settings.thinkingStyle }

  const evidence: Evidence[] = []
  const outcomes: ProbeOutcome[] = []
  for (const id of probes) {
    if (report.budget.aborted) { outcomes.push({ id, status: 'skipped', summary: '预算已用尽，未执行' }); continue }
    try {
      const out = await PROBES[id].run(ctx)
      evidence.push(...out.evidence)
      outcomes.push({ id, status: 'ok', summary: out.summary, ...out.data !== undefined ? { data: out.data } : {} })
    } catch (error) {
      if (error instanceof AbortedError || deps.signal?.aborted) throw error
      if (error instanceof BudgetExceededError) {
        report.budget.aborted = `运行中预算耗尽（${error.message}），后续请求已停止。`
        outcomes.push({ id, status: 'budget', summary: error.message })
        evidence.push({ probe: id, strength: 'weak', result: 'inconclusive', detail: `预算耗尽：${error.message}`, raw: null })
        continue
      }
      outcomes.push({ id, status: 'error', summary: redactor.redactString(errorMessage(error)) })
    }
  }

  const s = score(evidence)
  report.verdict = s.verdict
  report.verdictLabel = VERDICT_LABEL[s.verdict]
  report.confidence = s.confidence
  report.confidenceLabel = s.confidenceLabel
  report.reasons = s.reasons
  report.categories = s.categories
  report.counts = s.counts
  report.evidence = evidence
  report.probes = outcomes
  report.budget.actual = tracker.snapshot()
  report.calls = [...targetEp.calls, ...referenceEp?.calls ?? []]
  report.rateLimited = { target: targetEp.rateLimited, reference: referenceEp?.rateLimited ?? 0 }
  if (s.verdict === 'suspicious' && !reference && !baseline) {
    report.warnings.push('建议提供官方 reference，或先用 model_fingerprint_record 录制基线，以获得强证据。')
  }
  if (s.verdict !== 'inconsistent') report.warnings.push('建议在不同时段复测；混合路由的中转站可能只在部分时间或部分请求上替换模型。')
  return finish(report, redactor, deps, dataDir, deps.settings.saveReports)
}

async function finish(report: VerifyReport, redactor: Redactor, deps: RunnerDeps, dataDir: string, save: boolean): Promise<ToolResult> {
  let clean = toJsonValue(redactor.redact(report)) as VerifyReport
  if (save) {
    const base = reportBase(dataDir, clean.claimedModel, clean.generatedAt)
    clean = { ...clean, savedTo: `${base}.json` }
    try {
      await saveReport(base, clean, redactor.redactString(renderMarkdown(clean)))
    } catch (error) {
      clean = { ...clean, savedTo: undefined }
      clean.warnings.push(`报告保存失败：${redactor.redactString(errorMessage(error))}`)
    }
  }
  return { markdown: redactor.redactString(renderMarkdown(clean)), report: clean }
}

/** model_fingerprint_record */
export async function runRecord(args: RecordArgs, deps: RunnerDeps): Promise<ToolResult> {
  const now = deps.now ?? (() => new Date())
  const model = args.model ?? args.endpoint.model
  if (!model) throw new UsageError('model (or endpoint.model) is required')
  const probes = parseProbes(args.probes ?? [...RECORD_PROBES], RECORD_PROBES)
  const samples = parseSamples(args.samples, deps.settings.defaultSamples)
  const limits = mergeBudget(deps.settings.defaultBudget, args.budget)
  const redactor = new Redactor()
  const official = await resolveReference(deps.services, { ...args.endpoint, model }, model, resolveOptions(deps))
  redactor.add(official.secret)
  const vendor = vendorOf(model)
  const planCtx: PlanContext = { claimedModel: model, vendor, targetProtocol: official.info.protocol, hasReference: false, samples, mode: 'record' }
  const plan = probes.flatMap(p => PROBES[p].plan(planCtx))
  const est: BudgetEstimate = estimate(plan, { target: model }, limits)
  const over = exceeds(est, limits)
  const head = `# 基线录制：${model}\n\n- 官方端点：${official.info.origin}（${official.info.protocol}，凭据 ${official.info.keySource}）\n- 探针：${probes.join(', ')}；采样数 ${samples}\n- 估算：${est.requests} 次请求，输入约 ${est.inputTokens} token，输出上限 ${est.outputTokens} token，约 $${est.costUsd.toFixed(4)}\n`
  if (over || args.dryRun) {
    const reason = over ? `已中止，未发送任何请求：${over}` : 'dryRun：只做了估算，未发送请求。'
    return { markdown: redactor.redactString(`${head}\n**${reason}**\n`), report: toJsonValue(redactor.redact({ kind: 'record', recorded: false, reason, estimate: est, limits, endpoint: official.info })) }
  }
  const tracker = new BudgetTracker(limits, { target: model })
  // In record mode the official endpoint is the one being measured.
  const ep = makeEndpoint({ ...official, info: { ...official.info, role: 'target' } }, deps, tracker, redactor)
  const ctx: ProbeContext = { ...planCtx, target: ep, ...deps.signal ? { signal: deps.signal } : {}, record: {}, thinkingStyle: deps.settings.thinkingStyle }
  const outcomes: ProbeOutcome[] = []
  for (const id of probes) {
    try {
      const out = await PROBES[id].run(ctx)
      outcomes.push({ id, status: 'ok', summary: out.summary })
    } catch (error) {
      if (error instanceof AbortedError || deps.signal?.aborted) throw error
      outcomes.push({ id, status: error instanceof BudgetExceededError ? 'budget' : 'error', summary: redactor.redactString(errorMessage(error)) })
      if (error instanceof BudgetExceededError) break
    }
  }
  const baseline: Baseline = {
    schemaVersion: 1, id: newBaselineId(), model, protocol: official.info.protocol, vendor, recordedAt: now().toISOString(),
    endpointOrigin: official.info.origin, pluginVersion: PLUGIN_VERSION, corpusVersion: CORPUS_VERSION, samples,
    ...ctx.record,
  }
  const clean = toJsonValue(redactor.redact(baseline)) as Baseline
  const path = await saveBaseline(dataDirOf(deps), clean)
  const lines = [head, '## 结果', '', ...outcomes.map(o => `- **${o.id}**（${o.status}）：${o.summary}`), '', `- 实际：${tracker.snapshot().requests} 次请求，约 $${tracker.snapshot().costUsd.toFixed(4)}`, '', `基线 \`${clean.id}\` 已保存：\`${path}\``]
  return {
    markdown: redactor.redactString(lines.join('\n')),
    report: toJsonValue(redactor.redact({ kind: 'record', recorded: true, baseline: summarizeBaseline(clean, path), probes: outcomes, actual: tracker.snapshot(), estimate: est })),
  }
}

/** model_fingerprint_list */
export async function runList(args: { model?: string }, deps: RunnerDeps): Promise<ToolResult> {
  const dataDir = dataDirOf(deps)
  const all = (await readBaselines(dataDir)).filter(b => !args.model || b.baseline.model === args.model)
  const items: BaselineSummary[] = all.map(b => summarizeBaseline(b.baseline, b.path))
  const lines = [`# 已录制的基线（${items.length}）`, '', `数据目录：\`${dataDir}\``, '']
  if (items.length === 0) lines.push('暂无基线。用 `model_fingerprint_record` 针对官方端点录制。')
  else {
    lines.push('| id | 模型 | 协议 | 录制时间 | 官方端点 | 探针 | 采样 |', '|---|---|---|---|---|---|---|')
    for (const i of items) lines.push(`| ${i.id} | ${i.model} | ${i.protocol} | ${i.recordedAt} | ${i.endpointOrigin} | ${i.probes.join(',')} | ${i.samples} |`)
  }
  return { markdown: lines.join('\n'), report: toJsonValue({ kind: 'list', dataDir, baselines: items }) }
}

export { ResolveError }
