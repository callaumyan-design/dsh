/**
 * dsh-model-fingerprint — verify that a relay / custom gateway really serves
 * the model it claims. Registers three tools:
 *
 *   model_fingerprint_verify  probe an endpoint and score the evidence
 *   model_fingerprint_record  record a baseline fingerprint from an official endpoint
 *   model_fingerprint_list    list recorded baselines
 *
 * Requests go straight to the endpoint with native fetch (not through the
 * DSH LLM adapters) so raw headers, ids and usage fields are visible.
 */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_BUDGET } from './budget.ts'
import { truncateDeep } from './redact.ts'
import { DEFAULT_SETTINGS, runList, runRecord, runVerify, type RunnerDeps, type RunnerSettings, type ToolResult } from './runner.ts'
import { PROBE_IDS, PROTOCOLS } from './types.ts'

/** Cordis plugin name. */
export const name = 'model-fingerprint'
/** Only the tool registry is required; credentials, loader, llm and profileContext are read optionally via `ctx.get`. */
export const inject = ['tools']

export interface Config {
  dataDir?: string
  extraOfficialHosts: string[]
  allowInsecureHttp: boolean
  requestTimeoutMs: number
  maxRetries: number
  minIntervalMs: number
  maxBackoffMs: number
  toolTimeoutMs: number
  defaultSamples: number
  defaultBudget: {
    maxRequests: number
    maxInputTokens: number
    maxOutputTokens: number
    maxCostUsd: number
  }
  saveReports: boolean
  thinkingStyle: 'enabled' | 'adaptive'
  profile?: string
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().description('Baseline/report directory. Defaults to $DSH_HOME/data/model-fingerprint.'),
  extraOfficialHosts: Schema.array(Schema.string()).default([]).description('Extra hostnames treated as official (reference keys are only ever sent to official hosts).'),
  allowInsecureHttp: Schema.boolean().default(false).description('Allow plain http:// endpoints other than localhost.'),
  requestTimeoutMs: Schema.natural().min(1000).default(60_000).description('Per-request timeout.'),
  maxRetries: Schema.natural().max(8).default(3).description('Retries for 429/5xx/network errors (exponential backoff).'),
  minIntervalMs: Schema.natural().default(250).description('Minimum spacing between requests to one endpoint; doubles after each 429.'),
  maxBackoffMs: Schema.natural().min(100).default(30_000),
  toolTimeoutMs: Schema.natural().min(10_000).default(20 * 60_000).description('Cooperative timeout for one tool call.'),
  defaultSamples: Schema.natural().min(1).max(10).default(3),
  defaultBudget: Schema.object({
    maxRequests: Schema.natural().default(DEFAULT_BUDGET.maxRequests),
    maxInputTokens: Schema.natural().default(DEFAULT_BUDGET.maxInputTokens),
    maxOutputTokens: Schema.natural().default(DEFAULT_BUDGET.maxOutputTokens),
    maxCostUsd: Schema.number().min(0).default(DEFAULT_BUDGET.maxCostUsd),
  }).default({ ...DEFAULT_BUDGET }),
  saveReports: Schema.boolean().default(true).description('Write every verify report (JSON + Markdown) into the data directory.'),
  thinkingStyle: Schema.union(['enabled', 'adaptive']).default('enabled').description('Anthropic thinking request style for the signature probe (falls back automatically when the API asks for the other).'),
  profile: Schema.string().description('Profile whose cordis.patch.yml is read for providerId lookups when not running inside a dsh profile.'),
})

const ENDPOINT_PROPS = {
  providerId: { type: 'string', description: 'Provider route id from this profile (llm-pi-ai providers, or deepseek). Fills baseURL/protocol/apiKeyEnv from the profile configuration.' },
  baseURL: { type: 'string', description: 'Endpoint base URL in DSH form: OpenAI-compatible bases include /v1, Gemini bases include the API version (e.g. /v1beta), Anthropic bases exclude /v1.' },
  protocol: { type: 'string', enum: PROTOCOLS, description: 'Wire protocol the endpoint speaks.' },
  model: { type: 'string', description: 'Model id sent to the endpoint.' },
  apiKeyEnv: { type: 'string', description: 'Credential reference NAME (e.g. RELAY_API_KEY), resolved through the DSH credentials store ($DSH_HOME/.credentials.yaml) and the environment. Never pass a raw key.' },
  credentialRef: { type: 'string', description: 'Alias of apiKeyEnv.' },
} as const

const BUDGET_PROPS = {
  maxRequests: { type: 'integer', description: 'Hard cap on HTTP requests (retries included).' },
  maxInputTokens: { type: 'integer' },
  maxOutputTokens: { type: 'integer', description: 'Cap on the sum of output limits sent.' },
  maxCostUsd: { type: 'number', description: 'Cap on the estimated cost in USD.' },
  inputPricePerMTok: { type: 'number', description: 'Override the input price (USD per 1M tokens) used for estimates.' },
  outputPricePerMTok: { type: 'number', description: 'Override the output price (USD per 1M tokens).' },
} as const

const OUTPUT = {
  type: 'object',
  additionalProperties: false,
  properties: {
    markdown: { type: 'string', required: true },
    report: { type: 'json', required: true },
  },
} as const

/** Model-facing JSON: drop bulky raw fields (the canonical value and the saved file keep everything). */
export function modelView(report: unknown): unknown {
  if (report === null || typeof report !== 'object') return report
  const r = { ...(report as Record<string, unknown>) }
  if (Array.isArray(r.evidence)) r.evidence = r.evidence.map(e => { const { raw: _raw, ...rest } = e as Record<string, unknown>; return rest })
  if (Array.isArray(r.probes)) r.probes = r.probes.map(p => { const { data: _data, ...rest } = p as Record<string, unknown>; return rest })
  if (Array.isArray(r.calls)) r.calls = `${r.calls.length} requests (see saved report)`
  return truncateDeep(r, 400)
}

function render(value: ToolResult): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: `${value.markdown}\n\n结构化结果（精简）：\n\`\`\`json\n${JSON.stringify(modelView(value.report), null, 1)}\n\`\`\`` }]
}

export function settingsOf(config: Partial<Config>): RunnerSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)),
    defaultBudget: { ...DEFAULT_SETTINGS.defaultBudget, ...config.defaultBudget },
  } as RunnerSettings
}

export function apply(ctx: Context, config: Config): void {
  const settings = settingsOf(config ?? {})
  const deps = (signal: AbortSignal): RunnerDeps => ({ services: ctx, settings, signal })

  ctx.tools.register(defineTool({
    name: 'model_fingerprint_verify',
    description: 'Verify whether a model endpoint (relay / custom gateway) really serves the model it claims. Sends raw HTTP probes (differential tokenizer, protocol fingerprint, parameter compliance, behavior, performance; signature replay and context-limit only when listed in probes) and returns a Markdown report plus structured JSON with a verdict (一致/不一致/可疑), confidence, and per-probe evidence. Detects model substitution, injected system prompts, and tampered parameters. Estimates requests/tokens/cost first and aborts if the budget would be exceeded. Keys are referenced by name only (apiKeyEnv) and are masked in all output.',
    parameters: {
      target: { type: 'object', additionalProperties: false, required: true, properties: ENDPOINT_PROPS, description: 'Endpoint under test: either providerId (read from this profile) or baseURL+protocol+model+apiKeyEnv.' },
      claimedModel: { type: 'string', description: 'Model the endpoint claims to serve (defaults to target.model).' },
      reference: { type: 'object', additionalProperties: false, properties: ENDPOINT_PROPS, description: 'Optional OFFICIAL endpoint (api.anthropic.com, api.openai.com, generativelanguage.googleapis.com, api.deepseek.com) used as ground truth. Defaults fill in from claimedModel; pass {} plus apiKeyEnv to enable.' },
      probes: { type: 'array', items: { type: 'string', enum: PROBE_IDS }, description: 'Probes to run. Default: tokenizer, protocol, params, behavior, performance. signature (needs reference) and context_limit are expensive and only run when listed.' },
      budget: { type: 'object', additionalProperties: false, properties: BUDGET_PROPS, description: 'Hard limits for this call; defaults are conservative.' },
      samples: { type: 'integer', description: 'Repetitions for sampled probes (1-10, default 3).' },
      baseline: { type: 'string', description: 'Baseline id to compare with, "latest" (default) or "none".' },
      contextTokens: { type: 'integer', description: 'Prompt size for the context_limit probe (default 75% of the advertised window).' },
      dryRun: { type: 'boolean', description: 'Only estimate requests/tokens/cost; send nothing.' },
    },
    output: { schema: OUTPUT, render: (_args, value) => render(value as ToolResult) },
    timeoutMs: config?.toolTimeoutMs ?? 20 * 60_000,
    async execute(args, exec) {
      return await runVerify(args, deps(exec.signal)) as never
    },
  }))

  ctx.tools.register(defineTool({
    name: 'model_fingerprint_record',
    description: 'Record a baseline fingerprint of a model from its OFFICIAL endpoint (only official hosts are accepted) and save it to the plugin data directory, so later model_fingerprint_verify runs can compare a relay against it without an official key.',
    parameters: {
      endpoint: { type: 'object', additionalProperties: false, required: true, properties: ENDPOINT_PROPS, description: 'Official endpoint; baseURL/protocol default from the model vendor; apiKeyEnv names the official key.' },
      model: { type: 'string', description: 'Model id to record (defaults to endpoint.model).' },
      probes: { type: 'array', items: { type: 'string', enum: ['tokenizer', 'protocol', 'params', 'behavior', 'performance'] }, description: 'Probes to record (default: all five).' },
      budget: { type: 'object', additionalProperties: false, properties: BUDGET_PROPS },
      samples: { type: 'integer', description: 'Repetitions (1-10, default 3).' },
      dryRun: { type: 'boolean', description: 'Only estimate; send nothing.' },
    },
    output: { schema: OUTPUT, render: (_args, value) => render(value as ToolResult) },
    timeoutMs: config?.toolTimeoutMs ?? 20 * 60_000,
    async execute(args, exec) {
      return await runRecord(args, deps(exec.signal)) as never
    },
  }))

  ctx.tools.register(defineTool({
    name: 'model_fingerprint_list',
    description: 'List baseline fingerprints recorded by model_fingerprint_record (id, model, protocol, time, official endpoint).',
    parameters: {
      model: { type: 'string', description: 'Only list baselines for this model id.' },
    },
    output: { schema: OUTPUT, render: (_args, value) => render(value as ToolResult) },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return await runList(args, deps(exec.signal)) as never
    },
  }))
}
