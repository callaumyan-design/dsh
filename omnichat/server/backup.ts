// Scheduled database backups for the self-hosted server: a daily gzipped snapshot kept on local disk and,
// when configured, copied to an Azure Blob Storage container so a lost VM disk doesn't lose every chat.
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { gzip } from 'node:zlib';
import type { DB } from './db';

const gzipAsync = promisify(gzip);
const DAY = 86_400_000;
const NAME_RE = /^omnichat-\d{8}-\d{6}\.db\.gz$/;

export interface BackupInfo {
  name: string;
  size: number;
  createdAt: number;
}

export interface BackupStatus {
  backups: BackupInfo[];
  /** Container URL of the off-site copy, without any SAS query. */
  remote: string | null;
  lastRemote?: { at: number; ok: boolean; error?: string };
  running: boolean;
}

export interface BackupService {
  status(): Promise<BackupStatus>;
  run(): Promise<BackupInfo>;
  /** Contents of a local backup, or null when there is no such backup. */
  read(name: string): Promise<Uint8Array | null>;
}

interface Options {
  db: DB;
  dataDir: string;
  /** Azure container URL (https://<account>.blob.core.windows.net/<container>), optionally with a SAS query. */
  azureUrl?: string;
  keepLocal?: number;
  keepRemote?: number;
}

const stamp = (d: Date) =>
  `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}-` +
  `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}${String(d.getUTCSeconds()).padStart(2, '0')}`;

const IMDS = 'http://169.254.169.254/metadata';

async function imds(pathAndQuery: string): Promise<Response> {
  return fetch(`${IMDS}${pathAndQuery}`, { headers: { Metadata: 'true' }, signal: AbortSignal.timeout(3000) });
}

/** On an Azure VM, the `backup` tag names the container (set with az vm update --set tags.backup=<url>). */
async function azureTagUrl(): Promise<string | undefined> {
  try {
    const res = await imds('/instance/compute/tags?api-version=2021-02-01&format=text');
    if (!res.ok) return undefined;
    const tags = (await res.text()).split(';').map((t) => t.split(':'));
    const hit = tags.find(([k]) => k === 'backup');
    return hit ? hit.slice(1).join(':').trim() || undefined : undefined;
  } catch {
    return undefined;
  }
}

/** Blob client for one container: a SAS URL, or the VM's managed identity when the URL has no query. */
function azureContainer(containerUrl: string) {
  const u = new URL(containerUrl);
  const sas = u.search;
  const base = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
  let token: { value: string; expires: number } | null = null;

  async function headers(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    const h: Record<string, string> = { 'x-ms-version': '2023-11-03', ...extra };
    if (sas) return h;
    if (!token || token.expires < Date.now() + 60_000) {
      const res = await imds('/identity/oauth2/token?api-version=2018-02-01&resource=https%3A%2F%2Fstorage.azure.com%2F');
      if (!res.ok) throw new Error(`Managed identity token: ${res.status} ${(await res.text()).slice(0, 200)}`);
      const j = (await res.json()) as { access_token: string; expires_on: string };
      token = { value: j.access_token, expires: Number(j.expires_on) * 1000 };
    }
    return { ...h, authorization: `Bearer ${token.value}` };
  }
  const url = (name: string, query = '') => {
    const q = [sas.replace(/^\?/, ''), query].filter(Boolean).join('&');
    return `${base}${name ? `/${encodeURIComponent(name)}` : ''}${q ? `?${q}` : ''}`;
  };
  const check = async (res: Response, what: string) => {
    if (!res.ok) throw new Error(`${what}: ${res.status} ${(await res.text()).replace(/\s+/g, ' ').slice(0, 300)}`);
    return res;
  };

  return {
    display: base,
    async put(name: string, body: Uint8Array, onlyIfAbsent = false) {
      const res = await fetch(url(name), {
        method: 'PUT',
        headers: await headers({
          'x-ms-blob-type': 'BlockBlob',
          'content-type': 'application/octet-stream',
          ...(onlyIfAbsent ? { 'if-none-match': '*' } : {}),
        }),
        body: body as unknown as BodyInit,
      });
      if (onlyIfAbsent && res.status === 409) return;
      await check(res, `Upload ${name}`);
    },
    async list(prefix: string): Promise<string[]> {
      const res = await check(
        await fetch(url('', `restype=container&comp=list&prefix=${encodeURIComponent(prefix)}`), { headers: await headers() }),
        'List backups',
      );
      return [...(await res.text()).matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]);
    },
    async remove(name: string) {
      const res = await fetch(url(name), { method: 'DELETE', headers: await headers() });
      if (res.status !== 404) await check(res, `Delete ${name}`);
    },
  };
}

export function createBackupService(opts: Options): BackupService {
  const dir = path.join(opts.dataDir, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const keepLocal = opts.keepLocal ?? 7;
  const keepRemote = opts.keepRemote ?? 30;
  let remoteUrl: Promise<string | undefined> = opts.azureUrl ? Promise.resolve(opts.azureUrl) : azureTagUrl();
  let lastRemote: BackupStatus['lastRemote'];
  let running: Promise<BackupInfo> | null = null;

  const list = (): BackupInfo[] =>
    fs
      .readdirSync(dir)
      .filter((n) => NAME_RE.test(n))
      .map((name) => {
        const st = fs.statSync(path.join(dir, name));
        return { name, size: st.size, createdAt: st.mtimeMs };
      })
      .sort((a, b) => b.createdAt - a.createdAt);

  async function upload(info: BackupInfo, data: Uint8Array) {
    // Re-read the tag each time so setting it later doesn't need a restart.
    if (!opts.azureUrl) remoteUrl = azureTagUrl();
    const target = await remoteUrl;
    if (!target) return;
    try {
      const c = azureContainer(target);
      await c.put(info.name, data);
      // Stored API keys can only be decrypted with this file, so the off-site copy needs it once.
      const secretFile = path.join(opts.dataDir, 'secret.key');
      if (fs.existsSync(secretFile)) await c.put('secret.key', fs.readFileSync(secretFile), true);
      const old = (await c.list('omnichat-')).filter((n) => NAME_RE.test(n)).sort().reverse().slice(keepRemote);
      for (const n of old) await c.remove(n);
      lastRemote = { at: Date.now(), ok: true };
    } catch (err) {
      lastRemote = { at: Date.now(), ok: false, error: (err as Error).message };
      console.error('[omnichat] Off-site backup failed:', (err as Error).message);
    }
  }

  async function backupNow(): Promise<BackupInfo> {
    const name = `omnichat-${stamp(new Date())}.db.gz`;
    const tmp = path.join(dir, `.tmp-${process.pid}-${Date.now()}.db`);
    try {
      // VACUUM INTO writes a consistent, compacted copy while the app keeps running.
      await opts.db.run('VACUUM INTO ?', [tmp]);
      const data = await gzipAsync(fs.readFileSync(tmp), { level: 6 });
      fs.writeFileSync(path.join(dir, name), data);
      for (const old of list().slice(keepLocal)) fs.rmSync(path.join(dir, old.name), { force: true });
      const info = list().find((b) => b.name === name)!;
      await upload(info, data);
      return info;
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }

  const run = () => {
    if (!running) running = backupNow().finally(() => (running = null));
    return running;
  };

  // Once a day: checked hourly (and a minute after start), so restarts don't skip or repeat a day.
  const tick = () => {
    const latest = list()[0];
    if (!latest || Date.now() - latest.createdAt > DAY - 30 * 60_000) {
      run().catch((err) => console.error('[omnichat] Backup failed:', (err as Error).message));
    }
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 60 * 60_000).unref();

  return {
    async status() {
      const target = await remoteUrl;
      return {
        backups: list(),
        remote: target ? target.replace(/\?.*$/, '') : null,
        lastRemote,
        running: !!running,
      };
    },
    run,
    async read(name: string) {
      if (!NAME_RE.test(name)) return null;
      const p = path.join(dir, name);
      return fs.existsSync(p) ? new Uint8Array(fs.readFileSync(p)) : null;
    },
  };
}
