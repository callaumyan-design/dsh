/**
 * Endpoint resolution: tool arguments + (optionally) the active profile's
 * provider route + the DSH credential seam. Secrets are resolved here and
 * leave this module only inside an {@link Endpoint}'s transport.
 */
import { readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseDocument } from 'yaml'
import { allOfficialHosts, isOpenAIReasoningModel, officialDefaults, vendorOf } from './models.ts'
import { PROTOCOLS, type EndpointInfo, type Protocol } from './types.ts'
import type { AdapterOptions } from './protocols/common.ts'
import { isRecord, asString } from './util.ts'

/** What a caller may say about an endpoint. A raw key is never accepted. */
export interface EndpointArgs {
  providerId?: string
  baseURL?: string
  protocol?: string
  model?: string
  apiKeyEnv?: string
  credentialRef?: string
}

/** Minimal structural views of the optional DSH services we read (no hard dependency on their packages). */
interface CredentialsLike { resolve(ref: string): Promise<{ value: string; source: string } | undefined> }
interface LoaderEntryLike { options?: { id?: string; name?: string; config?: unknown; disabled?: boolean }; fiber?: { effectiveConfig?: unknown } }
interface LoaderLike { entries(): Iterable<LoaderEntryLike> }
interface LlmLike { listConfigurableProviders?(): Array<{ provider: string; defaultBaseURL?: string; nativeAuth?: { env: readonly string[] } }> }
interface ProfileContextLike { name: string; dir: string; patchPath: string; home: string }

/** The subset of a Cordis context this module needs. */
export interface ServiceSource { get(name: string): unknown }

export interface ResolveOptions {
  extraOfficialHosts: readonly string[]
  allowInsecureHttp: boolean
  /** Profile used for the file fallback when no profileContext is mounted. */
  profile?: string
  dshHome?: string
  env?: Record<string, string | undefined>
}

export interface ResolvedEndpoint {
  info: EndpointInfo
  secret: string
  headers: Record<string, string>
  adapterOptions: AdapterOptions
  warnings: string[]
}

export class ResolveError extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'ResolveError' }
}

const REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/
const PI_AI_PACKAGE = '@deepseek-ai/dsh-llm-pi-ai'
const DEEPSEEK_PACKAGES = ['@deepseek-ai/dsh-llm-deepseek-api-key', '@deepseek-ai/dsh-llm-deepseek']

/** Unwrap Schemastery `Volatile` values (objects exposing `get()`). */
function plain(value: unknown): unknown {
  if (value !== null && typeof value === 'object' && typeof (value as { get?: unknown }).get === 'function' && !Array.isArray(value) && !(value instanceof Map)) {
    try { return (value as { get(): unknown }).get() } catch { return value }
  }
  return value
}

/** Provider route as stored under `llm-pi-ai.providers.<id>` (only the fields we use). */
export interface ProviderRoute {
  api?: string
  baseURL?: string
  apiKeyEnv?: string
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  source: string
}

function routeFrom(raw: unknown, source: string): ProviderRoute | undefined {
  const r = plain(raw)
  if (!isRecord(r)) return undefined
  const headers: Record<string, string> = {}
  const rawHeaders = plain(r.headers)
  if (isRecord(rawHeaders)) for (const [k, v] of Object.entries(rawHeaders)) if (typeof v === 'string') headers[k] = v
  const compat = plain(r.compat)
  return {
    api: asString(plain(r.api)),
    baseURL: asString(plain(r.baseURL)),
    apiKeyEnv: asString(plain(r.apiKeyEnv)),
    headers,
    ...isRecord(compat) ? { compat } : {},
    source,
  }
}

/** Look a route up in the live Loader composition (the same configuration the adapters run with). */
function routeFromLoader(services: ServiceSource, providerId: string): ProviderRoute | undefined {
  const loader = services.get('loader') as LoaderLike | undefined
  if (!loader || typeof loader.entries !== 'function') return undefined
  for (const entry of loader.entries()) {
    const name = entry.options?.name
    const config = plain(entry.fiber?.effectiveConfig ?? entry.options?.config)
    if (!isRecord(config)) continue
    if (name === PI_AI_PACKAGE) {
      const providers = plain(config.providers)
      if (isRecord(providers) && providers[providerId] !== undefined) return routeFrom(providers[providerId], `loader:${entry.options?.id ?? name}`)
    }
    if (name !== undefined && DEEPSEEK_PACKAGES.includes(name) && /^deepseek(-official)?$/.test(providerId)) {
      return { api: 'anthropic-messages', baseURL: asString(plain(config.baseURL)), apiKeyEnv: asString(plain(config.apiKeyEnv)), headers: {}, source: `loader:${entry.options?.id ?? name}` }
    }
  }
  return undefined
}

/** Read the pi-ai route from profile + home patch files (later layer wins per row, whole `config` replaced). */
export async function routeFromPatchFiles(paths: readonly string[], providerId: string): Promise<ProviderRoute | undefined> {
  let piAi: Record<string, unknown> | undefined
  let deepseek: Record<string, unknown> | undefined
  let source = ''
  for (const path of paths) {
    let text: string
    try { text = await readFile(path, 'utf8') } catch { continue }
    const doc = parseDocument(text, { logLevel: 'silent' })
    const rows = doc.toJS({ maxAliasCount: 100 }) as unknown
    if (!Array.isArray(rows)) continue
    const visit = (row: unknown): void => {
      if (!isRecord(row)) return
      if (Array.isArray(row.insert)) { row.insert.forEach(visit); return }
      const id = asString(row.id)
      const name = asString(row.name)
      if ((id === 'llm-pi-ai' || name === PI_AI_PACKAGE) && isRecord(row.config)) { piAi = row.config; source = `file:${path}` }
      if ((id === 'llm-deepseek' || (name !== undefined && DEEPSEEK_PACKAGES.includes(name))) && isRecord(row.config)) deepseek = row.config
    }
    rows.forEach(visit)
  }
  const providers = piAi?.providers
  if (isRecord(providers) && providers[providerId] !== undefined) return routeFrom(providers[providerId], source)
  if (/^deepseek(-official)?$/.test(providerId)) {
    return { api: 'anthropic-messages', baseURL: asString(deepseek?.baseURL), apiKeyEnv: asString(deepseek?.apiKeyEnv), headers: {}, source: deepseek ? 'file:llm-deepseek' : 'builtin:deepseek' }
  }
  return undefined
}

export function resolveDshHome(services: ServiceSource, opts: ResolveOptions): string {
  const profile = services.get('profileContext') as ProfileContextLike | undefined
  if (profile?.home) return profile.home
  if (opts.dshHome) return opts.dshHome
  const env = opts.env ?? process.env
  const fromEnv = env.DSH_HOME
  return fromEnv !== undefined && fromEnv.trim() !== '' ? fromEnv : join(homedir(), '.dsh')
}

async function lookupRoute(services: ServiceSource, providerId: string, opts: ResolveOptions): Promise<ProviderRoute | undefined> {
  const live = routeFromLoader(services, providerId)
  if (live) return live
  const profile = services.get('profileContext') as ProfileContextLike | undefined
  const home = resolveDshHome(services, opts)
  const profileName = profile?.name ?? opts.profile ?? 'web'
  const patchPath = profile?.patchPath ?? join(home, 'profiles', profileName, 'cordis.patch.yml')
  return routeFromPatchFiles([patchPath, join(home, 'cordis.patch.yml')], providerId)
}

/** Defaults for catalog routes that store no endpoint (pi-ai catalog ids). */
function catalogDefaults(services: ServiceSource, providerId: string): { baseURL?: string; protocol?: Protocol; keyEnv?: string } {
  const llm = services.get('llm') as LlmLike | undefined
  let fromLlm: { defaultBaseURL?: string; nativeAuth?: { env: readonly string[] } } | undefined
  try { fromLlm = llm?.listConfigurableProviders?.().find(p => p.provider === providerId) } catch { fromLlm = undefined }
  const vendor = providerId === 'google' || providerId === 'gemini' ? 'google' : /^deepseek/.test(providerId) ? 'deepseek' : providerId === 'anthropic' ? 'anthropic' : providerId === 'openai' ? 'openai' : undefined
  const d = vendor ? officialDefaults(vendor) : undefined
  return {
    baseURL: fromLlm?.defaultBaseURL ?? d?.baseURL,
    protocol: d?.protocol,
    keyEnv: fromLlm?.nativeAuth?.env[0] ?? d?.keyEnv,
  }
}

/** Resolve a credential reference: DSH credentials service, else launch env, else `$DSH_HOME/.credentials.yaml`. */
export async function resolveSecret(services: ServiceSource, ref: string, opts: ResolveOptions): Promise<{ value: string; source: string }> {
  if (!REF_PATTERN.test(ref)) throw new ResolveError(`credential reference "${ref}" must be a POSIX identifier like RELAY_API_KEY (raw keys are never accepted)`, 'INVALID_CREDENTIAL_REF')
  const credentials = services.get('credentials') as CredentialsLike | undefined
  if (credentials && typeof credentials.resolve === 'function') {
    const hit = await credentials.resolve(ref)
    if (hit && hit.value.length > 0) return { value: hit.value.trim(), source: `credentials:${hit.source}` }
    throw new ResolveError(`credential ${ref} is not configured (DSH credentials store, then environment fallbacks)`, 'MISSING_CREDENTIAL')
  }
  const env = opts.env ?? process.env
  const fromEnv = env[ref]
  if (fromEnv !== undefined && fromEnv.trim() !== '') return { value: fromEnv.trim(), source: 'env' }
  const file = join(resolveDshHome(services, opts), '.credentials.yaml')
  try {
    const st = await stat(file)
    if (process.platform !== 'win32' && (st.mode & 0o077) !== 0) throw new ResolveError(`${file} is readable by other users; refusing to read it (chmod 600)`, 'INSECURE_CREDENTIALS_FILE')
    const doc = parseDocument(await readFile(file, 'utf8'), { logLevel: 'silent' }).toJS() as unknown
    const refs = isRecord(doc) && isRecord(doc.refs) ? doc.refs : undefined
    const value = refs?.[ref]
    if (typeof value === 'string' && value.trim() !== '') return { value: value.trim(), source: 'file' }
  } catch (error) {
    if (error instanceof ResolveError) throw error
  }
  throw new ResolveError(`credential ${ref} is not configured (environment or $DSH_HOME/.credentials.yaml)`, 'MISSING_CREDENTIAL')
}

function normalizeBaseURL(raw: string, opts: ResolveOptions): URL {
  let url: URL
  try { url = new URL(raw) } catch { throw new ResolveError(`invalid baseURL: ${raw}`, 'INVALID_BASE_URL') }
  const local = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(url.hostname)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (local || opts.allowInsecureHttp))) {
    throw new ResolveError(`baseURL must use https (plain http is only allowed for localhost or with allowInsecureHttp): ${url.origin}`, 'INSECURE_BASE_URL')
  }
  if (url.username || url.password) throw new ResolveError('baseURL must not embed credentials', 'INVALID_BASE_URL')
  if (url.search || url.hash) throw new ResolveError('baseURL must not carry a query string or fragment (keys are never put in URLs)', 'INVALID_BASE_URL')
  return url
}

function asProtocol(value: string | undefined): Protocol | undefined {
  return value !== undefined && (PROTOCOLS as readonly string[]).includes(value) ? value as Protocol : undefined
}

/** Official when the hostname (or `host:port`, for entries that name a port) is on the allowlist. */
export function isOfficialOrigin(origin: string, extra: readonly string[]): boolean {
  const url = new URL(origin)
  const host = url.hostname.toLowerCase()
  const hostPort = url.host.toLowerCase()
  return allOfficialHosts(extra).some(h => h === host || h === hostPort)
}

/** Resolve the endpoint under test. */
export async function resolveTarget(services: ServiceSource, args: EndpointArgs, claimedModel: string | undefined, opts: ResolveOptions): Promise<ResolvedEndpoint> {
  const warnings: string[] = []
  let route: ProviderRoute | undefined
  if (args.providerId) {
    route = await lookupRoute(services, args.providerId, opts)
    if (!route) throw new ResolveError(`provider "${args.providerId}" was not found in the live configuration or the profile patch files`, 'UNKNOWN_PROVIDER')
  }
  const defaults = args.providerId ? catalogDefaults(services, args.providerId) : {}
  const baseRaw = args.baseURL ?? route?.baseURL ?? defaults.baseURL
  if (!baseRaw) throw new ResolveError('target.baseURL is required (or a providerId whose route defines one)', 'MISSING_BASE_URL')
  const protocolRaw = args.protocol ?? route?.api
  const protocol = asProtocol(protocolRaw) ?? (protocolRaw === undefined ? defaults.protocol : undefined)
  if (!protocol) throw new ResolveError(`target.protocol must be one of ${PROTOCOLS.join(', ')} (got ${protocolRaw ?? 'nothing'})`, 'INVALID_PROTOCOL')
  const model = args.model ?? claimedModel
  if (!model) throw new ResolveError('target.model or claimedModel is required', 'MISSING_MODEL')
  const ref = args.apiKeyEnv ?? args.credentialRef ?? route?.apiKeyEnv ?? defaults.keyEnv
  if (!ref) throw new ResolveError('target.apiKeyEnv (credential reference) is required', 'MISSING_CREDENTIAL')
  const url = normalizeBaseURL(baseRaw, opts)
  const secret = await resolveSecret(services, ref, opts)
  const adapterOptions: AdapterOptions = {}
  const field = asString(route?.compat?.maxTokensField)
  if (field === 'max_tokens' || field === 'max_completion_tokens') adapterOptions.maxTokensField = field
  // OpenAI reasoning models only accept max_completion_tokens; most gateways only know max_tokens.
  else adapterOptions.maxTokensField = url.hostname === 'api.openai.com' || (vendorOf(model) === 'openai' && isOpenAIReasoningModel(model)) ? 'max_completion_tokens' : 'max_tokens'
  if (route) warnings.push(`target 路由取自 ${route.source.replace(/^file:.*/, 'profile 配置文件')}`)
  return {
    info: {
      role: 'target', baseURL: url.toString().replace(/\/+$/, ''), origin: url.origin, protocol, model,
      keySource: `${secret.source} ${ref}`, official: isOfficialOrigin(url.origin, opts.extraOfficialHosts),
      ...args.providerId ? { providerId: args.providerId } : {},
    },
    secret: secret.value,
    headers: route?.headers ?? {},
    adapterOptions,
    warnings,
  }
}

/** Resolve the official reference endpoint; refuses any non-official host. */
export async function resolveReference(services: ServiceSource, args: EndpointArgs, claimedModel: string, opts: ResolveOptions): Promise<ResolvedEndpoint> {
  const vendor = vendorOf(args.model ?? claimedModel)
  const defaults = officialDefaults(vendor)
  let route: ProviderRoute | undefined
  if (args.providerId) {
    route = await lookupRoute(services, args.providerId, opts)
    if (!route) throw new ResolveError(`reference provider "${args.providerId}" was not found`, 'UNKNOWN_PROVIDER')
  }
  const catalog = args.providerId ? catalogDefaults(services, args.providerId) : {}
  const baseRaw = args.baseURL ?? route?.baseURL ?? catalog.baseURL ?? defaults?.baseURL
  if (!baseRaw) throw new ResolveError(`no official endpoint is known for vendor "${vendor}"; pass reference.baseURL (it must be an official host)`, 'MISSING_BASE_URL')
  const url = normalizeBaseURL(baseRaw, opts)
  if (!isOfficialOrigin(url.origin, opts.extraOfficialHosts)) {
    throw new ResolveError(`reference endpoint ${url.origin} is not an official host (${allOfficialHosts(opts.extraOfficialHosts).join(', ')}); official keys are only sent to official domains`, 'NOT_OFFICIAL')
  }
  const protocolRaw = args.protocol ?? route?.api
  const protocol = asProtocol(protocolRaw) ?? (protocolRaw === undefined ? (catalog.protocol ?? defaults?.protocol) : undefined)
  if (!protocol) throw new ResolveError(`reference.protocol must be one of ${PROTOCOLS.join(', ')}`, 'INVALID_PROTOCOL')
  const ref = args.apiKeyEnv ?? args.credentialRef ?? route?.apiKeyEnv ?? catalog.keyEnv ?? defaults?.keyEnv
  if (!ref) throw new ResolveError('reference.apiKeyEnv (credential reference) is required', 'MISSING_CREDENTIAL')
  const secret = await resolveSecret(services, ref, opts)
  return {
    info: {
      role: 'reference', baseURL: url.toString().replace(/\/+$/, ''), origin: url.origin, protocol, model: args.model ?? claimedModel,
      keySource: `${secret.source} ${ref}`, official: true, ...args.providerId ? { providerId: args.providerId } : {},
    },
    secret: secret.value,
    headers: route?.headers ?? {},
    adapterOptions: { maxTokensField: url.hostname === 'api.openai.com' ? 'max_completion_tokens' : 'max_tokens' },
    warnings: [],
  }
}

/** Cross-endpoint key guard: an official key must never be sent to a non-official target. */
export function assertKeySeparation(target: ResolvedEndpoint, reference: ResolvedEndpoint | undefined): void {
  if (!reference) return
  if (target.secret === reference.secret && !target.info.official) {
    throw new ResolveError('target and reference resolve to the same key, but the target is not an official host: refusing to send an official key to a relay', 'KEY_REUSE')
  }
}
