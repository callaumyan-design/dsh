import { useRef, useState } from 'react';
import { Database, Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/primitives';
import { api, getToken } from '@/lib/api';
import { idb } from '@/lib/idb';
import { chunkOps, planImport } from '@/lib/importers';
import { getSyncLimits, pendingCount, pull } from '@/lib/sync';
import { downloadFile, readFileAsText } from '@/lib/utils';
import { removeConversation, useData } from '@/store/data';
import { confirmDialog, openConversation, toast } from '@/store/ui';
import { useT } from '@/i18n';

function Section({ icon, title, desc, children }: { icon: React.ReactNode; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line p-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 text-fg-muted [&_svg]:size-5">{icon}</div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">{title}</div>
          <div className="mt-0.5 text-xs leading-relaxed text-fg-subtle">{desc}</div>
          <div className="mt-3 flex flex-wrap items-center gap-2">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function DataTab() {
  const t = useT();
  const conversations = useData((s) => s.conversations);
  const providers = useData((s) => s.providers);
  const prompts = useData((s) => s.prompts);
  const [includeKeys, setIncludeKeys] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    setExporting(true);
    try {
      const res = await fetch(`/api/export${includeKeys ? '?includeKeys=1' : ''}`, { headers: { authorization: `Bearer ${getToken()}` } });
      if (!res.ok) throw new Error(`${res.status}`);
      const blob = await res.blob();
      const date = new Date().toISOString().slice(0, 10);
      downloadFile(`catgpt-backup-${date}.json`, blob);
    } catch (err) {
      toast(`${t('data.exportFailed')}: ${(err as Error).message}`, 'error');
    } finally {
      setExporting(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const plan = planImport(JSON.parse(await readFileAsText(file)));
      const ok = await confirmDialog({
        title: t('data.importConfirm'),
        message: t('data.importSummary', { conversations: plan.conversations, messages: plan.messages }),
        confirmText: t('data.import'),
      });
      if (!ok) return;
      const chunks = chunkOps(plan.ops, getSyncLimits().maxOps);
      for (let i = 0; i < chunks.length; i++) {
        setProgress(`${i + 1}/${chunks.length}`);
        await api('/api/sync/push', { body: { ops: chunks[i] } });
      }
      await pull();
      toast(t('data.imported', { n: plan.conversations }), 'success');
    } catch (err) {
      toast(`${t('data.importFailed')}: ${(err as Error).message}`, 'error', 6000);
    } finally {
      setProgress(null);
    }
  };

  return (
    <div className="space-y-4 p-5">
      <div className="grid grid-cols-3 gap-3">
        {[
          [t('data.statConversations'), Object.keys(conversations).length],
          [t('data.statProviders'), Object.keys(providers).length],
          [t('data.statPrompts'), Object.keys(prompts).length],
        ].map(([label, n]) => (
          <div key={label as string} className="rounded-xl bg-muted px-4 py-3">
            <div className="text-xl font-semibold tabular-nums">{n}</div>
            <div className="text-xs text-fg-subtle">{label}</div>
          </div>
        ))}
      </div>

      <Section icon={<Download />} title={t('data.export')} desc={t('data.exportDesc')}>
        <Button size="sm" variant="outline" loading={exporting} onClick={exportAll} icon={<Download className="size-4" />}>
          {t('data.exportButton')}
        </Button>
        <label className="flex items-center gap-2 text-xs text-fg-muted">
          <input type="checkbox" checked={includeKeys} onChange={(e) => setIncludeKeys(e.target.checked)} className="accent-[var(--accent)]" />
          {t('data.includeKeys')}
        </label>
      </Section>

      <Section icon={<Upload />} title={t('data.import')} desc={t('data.importDesc')}>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void importFile(f);
          }}
        />
        <Button size="sm" variant="outline" loading={!!progress} onClick={() => fileRef.current?.click()} icon={<Upload className="size-4" />}>
          {progress ? t('data.importing', { progress }) : t('data.chooseFile')}
        </Button>
      </Section>

      <Section icon={<Database />} title={t('data.cache')} desc={t('data.cacheDesc')}>
        <Button
          size="sm"
          variant="outline"
          icon={<RefreshCw className="size-4" />}
          onClick={async () => {
            if (pendingCount() > 0) {
              toast(t('data.pendingWait'), 'error');
              return;
            }
            if (await confirmDialog({ title: t('data.resyncConfirm') })) {
              await idb.clearAll();
              location.reload();
            }
          }}
        >
          {t('data.resync')}
        </Button>
      </Section>

      <Section icon={<Trash2 className="text-danger" />} title={t('data.danger')} desc={t('data.dangerDesc')}>
        <Button
          size="sm"
          variant="danger"
          onClick={async () => {
            const n = Object.keys(conversations).length;
            if (!n) return;
            if (await confirmDialog({ title: t('data.deleteAllConfirm', { n }), message: t('data.irreversible'), danger: true, confirmText: t('common.delete') })) {
              for (const id of Object.keys(conversations)) removeConversation(id);
              openConversation(null);
            }
          }}
        >
          {t('data.deleteAll')}
        </Button>
      </Section>
    </div>
  );
}
