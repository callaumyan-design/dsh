/** Baselines and reports under the plugin data directory (`$DSH_HOME/data/model-fingerprint` by default). */
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Baseline } from './types.ts'
import { isRecord, slug } from './util.ts'

export interface BaselineSummary {
  id: string
  model: string
  protocol: string
  vendor: string
  recordedAt: string
  endpointOrigin: string
  corpusVersion: string
  samples: number
  probes: string[]
  path: string
}

async function writeAtomic(path: string, content: string): Promise<void> {
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`
  await writeFile(tmp, content, { mode: 0o600 })
  await rename(tmp, path)
}

function stamp(iso: string): string {
  return iso.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')
}

export async function saveBaseline(dataDir: string, baseline: Baseline): Promise<string> {
  const dir = join(dataDir, 'baselines', slug(baseline.model))
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${stamp(baseline.recordedAt)}-${baseline.id}.json`)
  await writeAtomic(path, `${JSON.stringify(baseline, null, 2)}\n`)
  return path
}

function isBaseline(value: unknown): value is Baseline {
  return isRecord(value) && value.schemaVersion === 1 && typeof value.id === 'string' && typeof value.model === 'string' && typeof value.recordedAt === 'string'
}

export async function readBaselines(dataDir: string): Promise<Array<{ baseline: Baseline; path: string }>> {
  const root = join(dataDir, 'baselines')
  let models: string[]
  try { models = await readdir(root) } catch { return [] }
  const out: Array<{ baseline: Baseline; path: string }> = []
  for (const m of models) {
    let files: string[]
    try { files = await readdir(join(root, m)) } catch { continue }
    for (const f of files.filter(x => x.endsWith('.json'))) {
      const path = join(root, m, f)
      try {
        const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
        if (isBaseline(parsed)) out.push({ baseline: parsed, path })
      } catch { /* skip unreadable files */ }
    }
  }
  return out.sort((a, b) => b.baseline.recordedAt.localeCompare(a.baseline.recordedAt))
}

export function summarizeBaseline(baseline: Baseline, path: string): BaselineSummary {
  const probes = [
    baseline.tokenizer ? 'tokenizer' : undefined,
    baseline.protocolShape ? 'protocol' : undefined,
    baseline.params ? 'params' : undefined,
    baseline.behavior ? 'behavior' : undefined,
    baseline.performance ? 'performance' : undefined,
  ].filter((p): p is string => p !== undefined)
  return {
    id: baseline.id, model: baseline.model, protocol: baseline.protocol, vendor: baseline.vendor, recordedAt: baseline.recordedAt,
    endpointOrigin: baseline.endpointOrigin, corpusVersion: baseline.corpusVersion, samples: baseline.samples, probes, path,
  }
}

/** Find a baseline by id, or the latest for a model (same protocol preferred). */
export async function findBaseline(dataDir: string, selector: string, model: string, protocol?: string): Promise<{ baseline: Baseline; path: string } | undefined> {
  const all = await readBaselines(dataDir)
  if (selector !== 'latest') return all.find(b => b.baseline.id === selector)
  const forModel = all.filter(b => b.baseline.model === model)
  return forModel.find(b => b.baseline.protocol === protocol) ?? forModel[0]
}

/** Path (without extension) a report for this model/time is written to. */
export function reportBase(dataDir: string, model: string, generatedAt: string): string {
  return join(dataDir, 'reports', `${stamp(generatedAt)}-${slug(model)}`)
}

export async function saveReport(base: string, json: unknown, markdown: string): Promise<void> {
  await mkdir(join(base, '..'), { recursive: true })
  await writeAtomic(`${base}.md`, `${markdown}\n`)
  await writeAtomic(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`)
}

export function newBaselineId(): string {
  return randomUUID().replace(/-/g, '').slice(0, 10)
}
