/** Report assembly and Markdown rendering. */
import type { BudgetEstimate } from './budget.ts'
import type { CallLogEntry } from './endpoint.ts'
import type { Score } from './scoring.ts'
import { VERDICT_LABEL } from './scoring.ts'
import type { BudgetLimits, EndpointInfo, Evidence, ProbeId, ProbeOutcome, Vendor, Verdict } from './types.ts'

export interface VerifyReport {
  schemaVersion: 1
  kind: 'verify'
  generatedAt: string
  pluginVersion: string
  claimedModel: string
  vendor: Vendor
  target: EndpointInfo
  reference?: EndpointInfo
  baseline?: { id: string; recordedAt: string; model: string; protocol: string }
  probesRequested: ProbeId[]
  samples: number
  verdict: Verdict
  verdictLabel: string
  confidence: number
  confidenceLabel: string
  reasons: string[]
  categories?: Score['categories']
  counts?: Score['counts']
  evidence: Evidence[]
  probes: ProbeOutcome[]
  budget: { limits: BudgetLimits; estimate: BudgetEstimate; actual: { requests: number; inputTokens: number; outputTokens: number; costUsd: number }; aborted?: string }
  calls: CallLogEntry[]
  rateLimited: { target: number; reference: number }
  limitations: string[]
  warnings: string[]
  savedTo?: string
}

export const BASE_LIMITATIONS = [
  '中转站可能混合路由：部分请求走真模型、部分走替代模型。单次检测只覆盖本次发出的请求，建议在不同时段（高峰/低谷、不同日期）多次复测并对比。',
  'usage（token 用量）由端点自报，中转站可以改写。差分分词能抵消固定的注入前缀，但无法抵消按比例伪造的 usage。',
  '同一厂商的同代模型常共用分词器（例如 GPT-4o/4.1/5 均为 o200k_base，Gemini 各版本共用同一分词器），分词器探针能区分厂商/家族，不能区分同族型号。',
  '行为与性能探针是弱证据：注入的 system prompt 可以操纵自我介绍，速度受负载、地域和网络影响。',
  '签名回放只能证明响应由该厂商的官方模型生成，不能区分同厂商的不同型号；OpenAI/Gemini 的签名可能与账号或项目绑定，因此其失败只计为中等证据。',
  '结论是基于有限样本的统计判断，置信度为启发式估计，不是绝对结论。',
]

const STRENGTH_LABEL = { strong: '强', medium: '中', weak: '弱' } as const
const RESULT_LABEL = { match: '✅ 一致', mismatch: '❌ 不一致', inconclusive: '➖ 无结论' } as const

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').slice(0, 400)
}

function money(n: number): string {
  return `$${n.toFixed(4)}`
}

export function renderMarkdown(r: VerifyReport): string {
  const lines: string[] = []
  lines.push(`# 模型指纹验证报告：${r.claimedModel}`)
  lines.push('')
  if (r.verdict === 'not-run') {
    lines.push(`**结论：${r.verdictLabel}**`)
    lines.push('')
    for (const reason of r.reasons) lines.push(`- ${reason}`)
  } else {
    lines.push(`**结论：${r.verdictLabel}**　置信度：${r.confidenceLabel}（约 ${r.confidence.toFixed(2)}，启发式估计，不代表绝对确定）`)
  }
  lines.push('')
  lines.push(`- 目标端点：${r.target.origin}（${r.target.protocol}，模型 \`${r.target.model}\`，凭据 ${r.target.keySource}）`)
  if (r.reference) lines.push(`- 官方参考：${r.reference.origin}（${r.reference.protocol}，模型 \`${r.reference.model}\`，凭据 ${r.reference.keySource}）`)
  if (r.baseline) lines.push(`- 基线：${r.baseline.id}（${r.baseline.recordedAt}，${r.baseline.protocol}）`)
  lines.push(`- 探针：${r.probesRequested.join(', ')}；采样数 ${r.samples}；时间 ${r.generatedAt}`)
  lines.push('')

  if (r.verdict !== 'not-run' && r.categories) {
    lines.push('## 三类问题')
    lines.push('')
    lines.push('| 问题 | 判断 | 依据 |')
    lines.push('|---|---|---|')
    const rows: Array<[string, keyof NonNullable<VerifyReport['categories']>]> = [['模型被替换', 'substitution'], ['被注入 system prompt', 'injection'], ['参数被篡改', 'parameters']]
    for (const [label, key] of rows) {
      const c = r.categories[key]
      lines.push(`| ${label} | ${c.label} | ${cell(c.evidence.join(', ') || '-')} |`)
    }
    lines.push('')
  }

  if (r.reasons.length > 0 && r.verdict !== 'not-run') {
    lines.push(r.verdict === 'suspicious' ? '## 可疑原因' : '## 主要依据')
    lines.push('')
    for (const reason of r.reasons) lines.push(`- ${reason}`)
    lines.push('')
  }

  if (r.evidence.length > 0) {
    lines.push('## 证据')
    lines.push('')
    lines.push('| 探针 | 强度 | 结果 | 说明 |')
    lines.push('|---|---|---|---|')
    const order = { strong: 0, medium: 1, weak: 2 }
    for (const e of [...r.evidence].sort((a, b) => order[a.strength] - order[b.strength])) {
      lines.push(`| ${e.probe} | ${STRENGTH_LABEL[e.strength]} | ${RESULT_LABEL[e.result]} | ${cell(e.detail)} |`)
    }
    lines.push('')
  }

  if (r.probes.length > 0) {
    lines.push('## 探针执行情况')
    lines.push('')
    for (const p of r.probes) lines.push(`- **${p.id}**（${p.status}）：${p.summary}`)
    lines.push('')
  }

  lines.push('## 预算与成本')
  lines.push('')
  const b = r.budget
  lines.push(`- 上限：${b.limits.maxRequests} 次请求 / ${b.limits.maxInputTokens} 输入 token / ${b.limits.maxOutputTokens} 输出 token / ${money(b.limits.maxCostUsd)}`)
  lines.push(`- 执行前估算：${b.estimate.requests} 次请求，输入约 ${b.estimate.inputTokens} token，输出上限合计 ${b.estimate.outputTokens} token，费用上限约 ${money(b.estimate.costUsd)}`)
  if (r.verdict !== 'not-run') lines.push(`- 实际：${b.actual.requests} 次请求，输入 ${b.actual.inputTokens} token，输出 ${b.actual.outputTokens} token，约 ${money(b.actual.costUsd)}（按估算单价，非账单）`)
  for (const note of b.estimate.priceNotes) lines.push(`- ${note}`)
  if (b.aborted) lines.push(`- ⚠️ ${b.aborted}`)
  if (r.rateLimited.target + r.rateLimited.reference > 0) lines.push(`- 遇到 429 限流：目标 ${r.rateLimited.target} 次，参考 ${r.rateLimited.reference} 次（已自动降速重试）`)
  lines.push('')

  if (r.warnings.length > 0) {
    lines.push('## 提示')
    lines.push('')
    for (const w of r.warnings) lines.push(`- ${w}`)
    lines.push('')
  }

  lines.push('## 局限')
  lines.push('')
  for (const l of r.limitations) lines.push(`- ${l}`)
  lines.push('')
  if (r.savedTo) lines.push(`完整 JSON 报告已保存：\`${r.savedTo}\``)
  return lines.join('\n')
}

export { VERDICT_LABEL }
