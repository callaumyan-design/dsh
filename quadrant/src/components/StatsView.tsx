import { CircleAlert, Flame, Lightbulb, Table2, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { parseISODate, WEEKDAY_CN } from '../lib/date';
import { QMAP, QUADRANTS, QUADRANT_IDS } from '../lib/quadrants';
import { buildInsights, computeStats, type DayBucket, type Stats } from '../lib/stats';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { CenterAxes, Segmented } from './ui';

type Range = '7' | '14' | '30';

export function StatsView({ today }: { today: string }) {
  const tasks = useStore((s) => s.tasks);
  const [range, setRange] = useState<Range>('14');
  const days = Number(range);
  const stats = useMemo(() => computeStats(tasks, today, days), [tasks, today, days]);
  const insights = useMemo(() => buildInsights(stats), [stats]);
  const setTagFilter = useUI((s) => s.setTagFilter);
  const setView = useUI((s) => s.setView);

  return (
    <div className="stats">
      <div className="stats-inner">
        <div className="stats-filter">
          <Segmented<Range>
            label="统计范围"
            value={range}
            onChange={setRange}
            options={[
              { value: '7', label: '近 7 天' },
              { value: '14', label: '近 14 天' },
              { value: '30', label: '近 30 天' },
            ]}
          />
          <span className="stats-filter-note">图表和分配比例按所选范围统计；“未完成”为当前状态。</span>
        </div>

        <Tiles stats={stats} />

        <div className="stats-grid">
          <section className="panel panel-wide">
            <header className="panel-head">
              <h2>每日完成</h2>
              <p>近 {days} 天每天完成的任务，按象限堆叠</p>
            </header>
            <DailyChart data={stats.daily} today={today} />
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>精力分配</h2>
              <p>近 {days} 天完成的 {stats.doneInRange} 项任务落在哪个象限</p>
            </header>
            <AllocationMap stats={stats} />
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>建议</h2>
              <p>依据四象限法则，根据你的数据生成</p>
            </header>
            <ul className="insights">
              {insights.map((ins, i) => (
                <li key={i} className={`insight tone-${ins.tone}`}>
                  {ins.tone === 'warn' ? <CircleAlert aria-hidden /> : ins.tone === 'good' ? <TrendingUp aria-hidden /> : <Lightbulb aria-hidden />}
                  <span>{ins.text}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>未完成任务</h2>
              <p>当前各象限待办数量</p>
            </header>
            <OpenBars stats={stats} />
          </section>

          <section className="panel">
            <header className="panel-head">
              <h2>常用标签</h2>
              <p>点击标签可在矩阵中筛选</p>
            </header>
            {stats.topTags.length === 0 ? (
              <p className="empty-note">还没有标签。在任务里添加 #标签 来分类。</p>
            ) : (
              <table className="tag-table">
                <thead>
                  <tr>
                    <th scope="col">标签</th>
                    <th scope="col">未完成</th>
                    <th scope="col">已完成</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.topTags.map((t) => (
                    <tr key={t.tag}>
                      <td>
                        <button
                          type="button"
                          className="meta-tag"
                          onClick={() => {
                            setTagFilter(t.tag);
                            setView('matrix');
                          }}
                        >
                          #{t.tag}
                        </button>
                      </td>
                      <td className="num">{t.open}</td>
                      <td className="num">{t.done}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function Tiles({ stats }: { stats: Stats }) {
  const delta = stats.doneThisWeek - stats.doneLastWeek;
  return (
    <div className="tiles">
      <div className="tile">
        <div className="tile-label">未完成</div>
        <div className="tile-value">{stats.openTotal}</div>
        <SegBar counts={QUADRANT_IDS.map((q) => stats.open[q])} />
      </div>
      <div className="tile">
        <div className="tile-label">今日完成</div>
        <div className="tile-value">{stats.doneToday}</div>
        <div className="tile-sub">今天截止还剩 {stats.dueToday} 项</div>
      </div>
      <div className="tile">
        <div className="tile-label">本周完成</div>
        <div className="tile-value">{stats.doneThisWeek}</div>
        <div className={`tile-sub delta ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`}>
          {delta > 0 ? <TrendingUp aria-hidden /> : delta < 0 ? <TrendingDown aria-hidden /> : null}
          {delta === 0 ? '与上周持平' : `比上周${delta > 0 ? '多' : '少'} ${Math.abs(delta)} 项`}
        </div>
      </div>
      <div className={`tile${stats.overdue ? ' is-warn' : ''}`}>
        <div className="tile-label">
          {stats.overdue > 0 && <CircleAlert aria-hidden />}
          已逾期
        </div>
        <div className="tile-value">{stats.overdue}</div>
        <div className="tile-sub">{stats.overdue ? '需要处理或改期' : '没有逾期任务'}</div>
      </div>
      <div className="tile">
        <div className="tile-label">
          <Flame aria-hidden />
          连续完成
        </div>
        <div className="tile-value">
          {stats.streak}
          <small> 天</small>
        </div>
        <div className="tile-sub">每天至少完成一项</div>
      </div>
    </div>
  );
}

/** 细分段条：一个整体按象限拆分 */
function SegBar({ counts }: { counts: number[] }) {
  const total = counts.reduce((a, b) => a + b, 0);
  const label = QUADRANTS.map((q, i) => `${q.code} ${counts[i]}`).join('，');
  return (
    <div className="segbar" role="img" aria-label={`按象限：${label}`} title={label}>
      {total === 0 ? (
        <span className="segbar-empty" />
      ) : (
        QUADRANTS.map((q, i) => (counts[i] ? <span key={q.id} className={`q-${q.id}`} style={{ flexGrow: counts[i] }} /> : null))
      )}
    </div>
  );
}

function AllocationMap({ stats }: { stats: Stats }) {
  const total = stats.doneInRange;
  return (
    <div className="alloc axes-grid">
      <CenterAxes />
      {QUADRANTS.map((q) => {
        const n = stats.doneByQuadrant[q.id];
        const pct = total ? Math.round((n / total) * 100) : 0;
        return (
          <div key={q.id} className={`alloc-cell q-${q.id}`} style={{ ['--share' as string]: `${pct}%` }}>
            <div className="alloc-top">
              <span className="alloc-code">{q.code}</span>
              <span className="alloc-verb">{q.verb}</span>
            </div>
            <div className="alloc-pct">
              {total ? pct : '–'}
              {total > 0 && <small>%</small>}
            </div>
            <div className="alloc-n">{n} 项</div>
            <div className="meter" aria-hidden>
              <span />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function OpenBars({ stats }: { stats: Stats }) {
  const max = Math.max(1, ...QUADRANT_IDS.map((q) => stats.open[q]));
  return (
    <ul className="hbars">
      {QUADRANTS.map((q) => (
        <li key={q.id}>
          <span className="hbar-label">
            <b>{q.code}</b> {q.verb}
          </span>
          <span className="hbar-track">
            <span className={`hbar q-${q.id}`} style={{ width: `${(stats.open[q.id] / max) * 100}%` }} />
          </span>
          <span className="hbar-val">{stats.open[q.id]}</span>
        </li>
      ))}
    </ul>
  );
}

function niceMax(v: number): { max: number; step: number } {
  if (v <= 4) return { max: 4, step: 1 };
  if (v <= 8) return { max: 8, step: 2 };
  const step = Math.ceil(v / 4 / 5) * 5 || 5;
  return { max: step * 4, step };
}

/** 顶部圆角、底部方角的矩形路径 */
function roundTopRect(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

function DailyChart({ data, today }: { data: DayBucket[]; today: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(260, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const W = width;
  const H = 220;
  const pad = { l: 28, r: 8, t: 12, b: 26 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const peak = Math.max(0, ...data.map((d) => d.total));
  const { max, step } = niceMax(peak);
  const band = innerW / data.length;
  const barW = Math.min(24, band * 0.62);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const ticks = Array.from({ length: max / step + 1 }, (_, i) => i * step);
  // 根据可用宽度决定日期标签间隔，避免重叠
  const labelEvery = Math.max(1, Math.ceil(40 / band));
  const GAP = 2;
  const dayLabel = (iso: string) => {
    const d = parseISODate(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  if (table) {
    return (
      <div className="chart-wrap">
        <div className="chart-tools">
          <Legend />
          <button type="button" className="btn ghost sm" onClick={() => setTable(false)}>
            查看图表
          </button>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">日期</th>
                {QUADRANTS.map((q) => (
                  <th key={q.id} scope="col">
                    {q.code}
                  </th>
                ))}
                <th scope="col">合计</th>
              </tr>
            </thead>
            <tbody>
              {[...data].reverse().map((d) => (
                <tr key={d.date}>
                  <td>
                    {dayLabel(d.date)} 周{WEEKDAY_CN[parseISODate(d.date).getDay()]}
                  </td>
                  {QUADRANT_IDS.map((q) => (
                    <td key={q} className="num">
                      {d.counts[q]}
                    </td>
                  ))}
                  <td className="num">
                    <b>{d.total}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  const hd = hover !== null ? data[hover] : null;
  const tipLeft = hover !== null ? ((pad.l + band * hover + band / 2) / W) * 100 : 0;

  return (
    <div className="chart-wrap">
      <div className="chart-tools">
        <Legend />
        <button type="button" className="btn ghost sm" onClick={() => setTable(true)}>
          <Table2 aria-hidden />
          表格
        </button>
      </div>
      <div className="chart" ref={wrapRef} onPointerLeave={() => setHover(null)}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label="每日完成任务数柱状图">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 6} y={y(t)} className="tick" textAnchor="end" dominantBaseline="middle">
                {t}
              </text>
            </g>
          ))}
          {data.map((d, i) => {
            const cx = pad.l + band * i + band / 2;
            const x = cx - barW / 2;
            let acc = 0;
            const segs = QUADRANT_IDS.filter((q) => d.counts[q] > 0);
            return (
              <g key={d.date} className={hover === i ? 'is-hover' : ''}>
                {segs.map((q, si) => {
                  const v = d.counts[q];
                  const y0 = y(acc);
                  const y1 = y(acc + v);
                  acc += v;
                  const top = si === segs.length - 1;
                  const h = Math.max(0, y0 - y1 - (si > 0 ? GAP : 0));
                  const yy = y1;
                  return top ? (
                    <path key={q} d={roundTopRect(x, yy, barW, h, 4)} className={`bar q-${q}`} />
                  ) : (
                    <rect key={q} x={x} y={yy} width={barW} height={h} className={`bar q-${q}`} />
                  );
                })}
                {(i % labelEvery === (data.length - 1) % labelEvery || d.date === today) && (
                  <text x={cx} y={H - 8} className={`tick${d.date === today ? ' is-today' : ''}`} textAnchor="middle">
                    {d.date === today ? '今天' : dayLabel(d.date)}
                  </text>
                )}
                <rect
                  x={pad.l + band * i}
                  y={pad.t}
                  width={band}
                  height={innerH}
                  className="hit"
                  tabIndex={0}
                  role="img"
                  aria-label={`${dayLabel(d.date)} 完成 ${d.total} 项`}
                  onPointerEnter={() => setHover(i)}
                  onFocus={() => setHover(i)}
                  onBlur={() => setHover(null)}
                />
              </g>
            );
          })}
          <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} className="axis-line" />
        </svg>
        {hd && (
          <div className={`tooltip${tipLeft > 70 ? ' is-left' : ''}`} style={{ left: `${tipLeft}%` }} role="status">
            <div className="tooltip-title">
              {dayLabel(hd.date)} 周{WEEKDAY_CN[parseISODate(hd.date).getDay()]}
              {hd.date === today && ' · 今天'}
            </div>
            <div className="tooltip-total">
              <b>{hd.total}</b> 项完成
            </div>
            {QUADRANTS.map((q) => (
              <div key={q.id} className="tooltip-row">
                <span className={`line-key q-${q.id}`} />
                <b>{hd.counts[q.id]}</b>
                <span>
                  {q.code} {q.verb}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Legend() {
  return (
    <ul className="legend" aria-label="图例">
      {QUADRANTS.map((q) => (
        <li key={q.id}>
          <span className={`swatch q-${q.id}`} />
          {q.code} {QMAP[q.id].verb}
        </li>
      ))}
    </ul>
  );
}
