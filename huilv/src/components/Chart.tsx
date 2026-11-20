import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { movingAverage, type Candle, type Interval } from '../lib/history';
import { formatRate } from '../lib/format';

const DEFAULT_H = 236;
const PAD_T = 18;
const PAD_B = 24;
const PAD_R = 58;

/** 坐标轴刻度的小数位数：按刻度间距决定 */
function axisDecimals(span: number): number {
  if (!(span > 0)) return 2;
  return Math.max(0, Math.min(8, 1 - Math.floor(Math.log10(span / 4))));
}

const nf = (d: number) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

export function dateLabel(t: number, interval: Interval, long = false): string {
  const d = new Date(t);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  const day = d.getUTCDate();
  if (interval === '1mo') return long ? `${y}年${m}月` : `${y}/${m}`;
  if (!long) return `${m}/${day}`;
  // 今年的日期省略年份
  return y === new Date().getUTCFullYear() ? `${m}月${day}日` : `${y}年${m}月${day}日`;
}

export interface ChartProps {
  candles: Candle[];
  interval: Interval;
  /** 当前指着的那一根（null 表示没有指着，显示最后一根） */
  onHover: (i: number | null) => void;
  hover: number | null;
  /** 高度跟随容器（电脑上的走势栏）；否则固定 236 像素 */
  fill?: boolean;
}

/** K 线图，带 MA5 / MA20 和最高最低价标注。指针在图上移动时显示十字线。 */
export function Chart({ candles, interval, onHover, hover, fill }: ChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(360);
  const [boxH, setBoxH] = useState(DEFAULT_H);
  const H = fill ? Math.max(150, boxH) : DEFAULT_H;

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setW(Math.max(200, Math.round(r.width)));
      setBoxH(Math.round(r.height));
    };
    update();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, []);

  const n = candles.length;
  const plotW = w - PAD_R;
  const plotH = H - PAD_T - PAD_B;
  const band = plotW / Math.max(1, n);

  const geo = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    let hiI = 0;
    let loI = 0;
    candles.forEach((k, i) => {
      if (k.h > hi) {
        hi = k.h;
        hiI = i;
      }
      if (k.l < lo) {
        lo = k.l;
        loI = i;
      }
    });
    const pad = (hi - lo) * 0.1 || hi * 0.002 || 1;
    const top = hi + pad;
    const bottom = lo - pad;
    const y = (v: number) => PAD_T + (1 - (v - bottom) / (top - bottom)) * plotH;
    const ticks = [0, 1, 2, 3].map((i) => bottom + ((top - bottom) * (i + 0.5)) / 4);
    const dec = axisDecimals(top - bottom);
    return { hi, lo, hiI, loI, y, ticks, fmt: nf(dec) };
  }, [candles, plotH, H]);

  const x = (i: number) => band * (i + 0.5);
  const ma5 = useMemo(() => (n >= 8 ? movingAverage(candles, 5) : []), [candles, n]);
  const ma20 = useMemo(() => (n >= 25 ? movingAverage(candles, 20) : []), [candles, n]);

  const path = (vals: (number | null)[]) => {
    let d = '';
    vals.forEach((v, i) => {
      if (v === null) return;
      d += `${d ? 'L' : 'M'}${x(i).toFixed(1)},${geo.y(v).toFixed(1)}`;
    });
    return d;
  };

  const last = candles[n - 1];
  const lastUp = n > 1 ? last.c >= candles[n - 2].c : true;
  const bodyW = Math.max(1, Math.min(12, band * 0.64));

  const xTicks = n > 2 ? [Math.round(n * 0.12), Math.round(n * 0.5), Math.round(n * 0.88)].filter((i) => i > 0 && i < n) : [];

  const pick = (e: RPointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientX - r.left) / band);
    onHover(Math.max(0, Math.min(n - 1, i)));
  };

  const hk = hover !== null ? candles[hover] : null;

  /** 最高、最低价标注：靠左的点把文字放右边，靠右的放左边 */
  const mark = (i: number, v: number, below: boolean) => {
    const right = i < n * 0.6;
    const cx = x(i);
    const cy = geo.y(v) + (below ? 12 : -6);
    return (
      <text className="k-mark" x={right ? cx + 4 : cx - 4} y={cy} textAnchor={right ? 'start' : 'end'}>
        {right ? `← ${formatRate(v)}` : `${formatRate(v)} →`}
      </text>
    );
  };

  return (
    <div className={`chart${fill ? ' is-fill' : ''}`} ref={box}>
      <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`走势图，共 ${n} 个数据点，最高 ${formatRate(geo.hi)}，最低 ${formatRate(geo.lo)}`}>
        {geo.ticks.map((v) => (
          <g key={v}>
            <line className="k-grid" x1={0} x2={plotW} y1={geo.y(v)} y2={geo.y(v)} />
            <text className="k-axis" x={plotW + 6} y={geo.y(v) + 4}>
              {geo.fmt.format(v)}
            </text>
          </g>
        ))}
        {xTicks.map((i) => (
          <text key={i} className="k-axis" x={x(i)} y={H - 6} textAnchor="middle">
            {dateLabel(candles[i].t, interval)}
          </text>
        ))}

        {candles.map((k, i) => {
          const up = k.c >= k.o;
          const top = geo.y(Math.max(k.o, k.c));
          const bot = geo.y(Math.min(k.o, k.c));
          return (
            <g key={k.t} className={up ? 'k-up' : 'k-down'}>
              <line x1={x(i)} x2={x(i)} y1={geo.y(k.h)} y2={geo.y(k.l)} />
              <rect x={x(i) - bodyW / 2} y={top} width={bodyW} height={Math.max(1, bot - top)} />
            </g>
          );
        })}

        {ma5.length > 0 && <path className="k-ma k-ma5" d={path(ma5)} />}
        {ma20.length > 0 && <path className="k-ma k-ma20" d={path(ma20)} />}

        {n > 1 && mark(geo.hiI, geo.hi, false)}
        {n > 1 && geo.loI !== geo.hiI && mark(geo.loI, geo.lo, true)}

        {last && hover === null && (
          <g className={lastUp ? 'k-last k-last-up' : 'k-last k-last-down'}>
            <line x1={0} x2={plotW} y1={geo.y(last.c)} y2={geo.y(last.c)} />
            <rect x={plotW + 1} y={geo.y(last.c) - 9} width={PAD_R - 2} height={18} rx={4} />
            <text x={plotW + 5} y={geo.y(last.c) + 4}>
              {geo.fmt.format(last.c)}
            </text>
          </g>
        )}

        {hk && hover !== null && (
          <g className="k-cross">
            <line x1={x(hover)} x2={x(hover)} y1={PAD_T - 6} y2={PAD_T + plotH} />
            <line x1={0} x2={plotW} y1={geo.y(hk.c)} y2={geo.y(hk.c)} />
            <rect x={plotW + 1} y={geo.y(hk.c) - 9} width={PAD_R - 2} height={18} rx={4} />
            <text x={plotW + 5} y={geo.y(hk.c) + 4}>
              {geo.fmt.format(hk.c)}
            </text>
          </g>
        )}

        <rect
          className="k-hit"
          x={0}
          y={0}
          width={plotW}
          height={H - PAD_B}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            pick(e);
          }}
          onPointerMove={(e) => {
            if (e.pointerType === 'mouse' || e.buttons) pick(e);
          }}
          onPointerUp={(e) => e.pointerType !== 'mouse' && onHover(null)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(null)}
          onPointerCancel={() => onHover(null)}
        />
      </svg>
    </div>
  );
}
