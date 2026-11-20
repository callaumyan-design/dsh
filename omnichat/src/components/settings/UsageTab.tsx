import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Segmented } from '@/components/ui/primitives';
import { api } from '@/lib/api';
import { formatNumber } from '@/lib/utils';
import { useLang, useT } from '@/i18n';

interface Row {
  model: string | null;
  provider: string | null;
  day: number;
  requests: number;
  input: number;
  output: number;
}

// Categorical slots 1-2 of the validated reference palette (checked against this app's light and dark surfaces).
const SERIES_CSS = `
.usage-viz { --series-input: #2a78d6; --series-output: #eb6834; }
.dark .usage-viz { --series-input: #3987e5; --series-output: #d95926; }
`;

const DAY = 86_400_000;

function barPath(x: number, y: number, w: number, h: number, r: number) {
  // Rounded data-end (top), square at the baseline.
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

/** Exact, compact axis labels: 1250 -> 1.25k (formatNumber would round it to 1.3k). */
function tickLabel(v: number) {
  if (v >= 1_000_000) return `${+(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `${+(v / 1000).toFixed(2)}k`;
  return String(Math.round(v));
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-muted px-4 py-3">
      <div className="text-2xl font-semibold tabular-nums" title={value.toLocaleString()}>
        {formatNumber(value) || '0'}
      </div>
      <div className="text-xs text-fg-subtle">{label}</div>
    </div>
  );
}

function DailyChart({ days, byDay, lang }: { days: number[]; byDay: Map<number, { input: number; output: number }>; lang: 'zh' | 'en' }) {
  const t = useT();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const height = 200;
  const pad = { top: 8, right: 4, bottom: 22, left: 44 };
  const plotW = Math.max(10, width - pad.left - pad.right);
  const plotH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(0, ...days.map((d) => (byDay.get(d)?.input ?? 0) + (byDay.get(d)?.output ?? 0))));
  const band = plotW / days.length;
  const barW = Math.max(2, Math.min(24, band * 0.62));
  const y = (v: number) => pad.top + plotH - (v / max) * plotH;
  const tzOffset = new Date().getTimezoneOffset() * 60_000;
  const dateOf = (d: number) => new Date(d * DAY + tzOffset);
  const fmtDay = (d: number) => dateOf(d).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'numeric', day: 'numeric' });
  const labelEvery = Math.ceil(days.length / Math.max(2, Math.floor(plotW / 56)));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const hv = hover !== null ? byDay.get(days[hover]) : undefined;

  return (
    <div ref={wrapRef} className="usage-viz relative" onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" aria-label={t('usage.chartTitle')} className="block">
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={1} />
            <text x={pad.left - 6} y={y(v)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--fg-subtle)">
              {tickLabel(v)}
            </text>
          </g>
        ))}
        {days.map((d, i) => {
          const v = byDay.get(d) ?? { input: 0, output: 0 };
          const x = pad.left + i * band + (band - barW) / 2;
          const gap = v.input > 0 && v.output > 0 ? 2 : 0;
          const hIn = (v.input / max) * plotH;
          const hOut = Math.max(0, (v.output / max) * plotH - gap);
          const base = pad.top + plotH;
          return (
            <g key={d} opacity={hover === null || hover === i ? 1 : 0.45}>
              {v.input > 0 && (
                <path d={v.output > 0 ? `M${x},${base}V${base - hIn}H${x + barW}V${base}Z` : barPath(x, base - hIn, barW, hIn, 4)} fill="var(--series-input)" />
              )}
              {v.output > 0 && hOut > 0 && <path d={barPath(x, base - hIn - gap - hOut, barW, hOut, 4)} fill="var(--series-output)" />}
              {i % labelEvery === 0 && (
                <text x={pad.left + i * band + band / 2} y={height - 6} textAnchor="middle" fontSize={10} fill="var(--fg-subtle)">
                  {fmtDay(d)}
                </text>
              )}
              <rect
                x={pad.left + i * band}
                y={pad.top}
                width={band}
                height={plotH}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onTouchStart={() => setHover(i)}
              />
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-elevated px-3 py-2 text-xs shadow-pop"
          style={{
            left: Math.min(Math.max(0, pad.left + hover * band + band / 2 - 72), Math.max(0, width - 150)),
          }}
        >
          <div className="mb-1 font-medium text-fg">{dateOf(days[hover]).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')}</div>
          <div className="flex items-center justify-between gap-4 text-fg-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: 'var(--series-input)' }} />
              {t('usage.input')}
            </span>
            <span className="text-fg tabular-nums">{(hv?.input ?? 0).toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between gap-4 text-fg-muted">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-sm" style={{ background: 'var(--series-output)' }} />
              {t('usage.output')}
            </span>
            <span className="text-fg tabular-nums">{(hv?.output ?? 0).toLocaleString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function UsageTab() {
  const t = useT();
  const lang = useLang();
  const [range, setRange] = useState<'7' | '30' | '90'>('30');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRows(null);
    setError(null);
    api<{ rows: Row[] }>(`/api/stats?days=${range}&tzOffset=${new Date().getTimezoneOffset()}`)
      .then((r) => setRows(r.rows))
      .catch((err) => setError((err as Error).message));
  }, [range]);

  const data = useMemo(() => {
    if (!rows) return null;
    const today = Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / DAY);
    const days = Array.from({ length: Number(range) }, (_, i) => today - Number(range) + 1 + i);
    const byDay = new Map<number, { input: number; output: number }>();
    const byModel = new Map<string, { model: string; provider: string; requests: number; input: number; output: number }>();
    let requests = 0;
    let input = 0;
    let output = 0;
    for (const r of rows) {
      requests += r.requests;
      input += r.input;
      output += r.output;
      const d = byDay.get(r.day) ?? { input: 0, output: 0 };
      d.input += r.input;
      d.output += r.output;
      byDay.set(r.day, d);
      const key = `${r.provider ?? ''}::${r.model ?? ''}`;
      const m = byModel.get(key) ?? { model: r.model ?? '?', provider: r.provider ?? '', requests: 0, input: 0, output: 0 };
      m.requests += r.requests;
      m.input += r.input;
      m.output += r.output;
      byModel.set(key, m);
    }
    const models = [...byModel.values()].sort((a, b) => b.input + b.output - (a.input + a.output) || b.requests - a.requests);
    return { days, byDay, models, requests, input, output };
  }, [rows, range]);

  return (
    <div className="space-y-5 p-5">
      <style>{SERIES_CSS}</style>
      <div className="flex flex-wrap items-center gap-3">
        <p className="flex-1 text-sm text-fg-muted">{t('usage.desc')}</p>
        <Segmented<'7' | '30' | '90'>
          value={range}
          onChange={setRange}
          options={[
            { value: '7', label: t('usage.days', { n: 7 }) },
            { value: '30', label: t('usage.days', { n: 30 }) },
            { value: '90', label: t('usage.days', { n: 90 }) },
          ]}
        />
      </div>
      {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</div>}
      {!data && !error && (
        <div className="flex justify-center py-16 text-fg-subtle">
          <Loader2 className="size-5 animate-spin" />
        </div>
      )}
      {data && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Tile label={t('usage.requests')} value={data.requests} />
            <Tile label={t('usage.inputTokens')} value={data.input} />
            <Tile label={t('usage.outputTokens')} value={data.output} />
          </div>
          <div className="rounded-xl border border-line p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">{t('usage.chartTitle')}</div>
              <div className="usage-viz flex items-center gap-4 text-xs text-fg-muted">
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: 'var(--series-input)' }} />
                  {t('usage.input')}
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="size-2.5 rounded-sm" style={{ background: 'var(--series-output)' }} />
                  {t('usage.output')}
                </span>
              </div>
            </div>
            <DailyChart days={data.days} byDay={data.byDay} lang={lang} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-soft text-left text-xs text-fg-subtle">
                  <th className="px-3 py-2 font-medium">{t('usage.model')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('usage.requests')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('usage.input')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('usage.output')}</th>
                </tr>
              </thead>
              <tbody>
                {data.models.map((m) => (
                  <tr key={`${m.provider}::${m.model}`} className="border-b border-line last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-mono text-[13px]">{m.model}</div>
                      {m.provider && <div className="text-xs text-fg-subtle">{m.provider}</div>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.requests.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.input.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.output.toLocaleString()}</td>
                  </tr>
                ))}
                {!data.models.length && (
                  <tr>
                    <td colSpan={4} className="px-3 py-8 text-center text-fg-subtle">
                      {t('usage.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-xs leading-relaxed text-fg-subtle">{t('usage.note')}</p>
        </>
      )}
    </div>
  );
}
