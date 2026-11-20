import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftRight, RefreshCw } from 'lucide-react';
import { CURRENCY_MAP } from '../lib/currencies';
import { fetchHistory, rangeInfo, RANGES, type History, type Range } from '../lib/history';
import { changePct, formatAgo, formatPct, formatRate } from '../lib/format';
import { Flag } from './Flag';
import { Chart, dateLabel } from './Chart';
import { Sheet } from './Sheet';

declare const __SINGLE_FILE__: boolean;
declare const __LIVE_URL__: string;

const CACHE_KEY = 'huilv:history';
const FRESH_MS = 15 * 60 * 1000;
const MAX_CACHED = 16;

const memory = new Map<string, History>();

function readCache(): Record<string, History> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, History>;
  } catch {
    return {};
  }
}

function saveCache(key: string, h: History) {
  try {
    const all = readCache();
    all[key] = h;
    const keys = Object.keys(all).sort((a, b) => all[b].fetchedAt - all[a].fetchedAt);
    for (const k of keys.slice(MAX_CACHED)) delete all[k];
    localStorage.setItem(CACHE_KEY, JSON.stringify(all));
  } catch {
    /* 存不了就只放在内存里 */
  }
}

type Load = { state: 'loading'; data?: History } | { state: 'ok'; data: History } | { state: 'error'; data?: History };

function useHistory(from: string, to: string, range: Range) {
  const key = `${from}-${to}-${range}`;
  const [load, setLoad] = useState<Load>(() => {
    const cached = memory.get(key) ?? readCache()[key];
    return cached ? { state: 'loading', data: cached } : { state: 'loading' };
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let alive = true;
    const cached = memory.get(key) ?? readCache()[key];
    if (cached && Date.now() - cached.fetchedAt < FRESH_MS && nonce === 0) {
      setLoad({ state: 'ok', data: cached });
      return;
    }
    setLoad({ state: 'loading', data: cached });
    const http = /^https?:$/.test(location.protocol);
    fetchHistory(from, to, range, { apiBase: http ? new URL('api/history', location.href).href : null })
      .then((h) => {
        memory.set(key, h);
        saveCache(key, h);
        if (alive) setLoad({ state: 'ok', data: h });
      })
      .catch(() => alive && setLoad({ state: 'error', data: cached }));
    return () => {
      alive = false;
    };
  }, [key, from, to, range, nonce]);

  const retry = useCallback(() => setNonce((n) => n + 1), []);
  return { load, retry };
}

/** 一种货币相对另一种的走势：K 线、涨跌、最高最低 */
export function Trend({ pair, onClose, onInvert }: { pair: { from: string; to: string } | null; onClose: () => void; onInvert: () => void }) {
  return (
    <Sheet open={!!pair} title={pair ? `${pair.from}/${pair.to} 走势` : '走势'} onClose={onClose} head={pair ? <TrendHead from={pair.from} to={pair.to} onInvert={onInvert} /> : null}>
      {pair && <TrendBody key={`${pair.from}-${pair.to}`} from={pair.from} to={pair.to} />}
    </Sheet>
  );
}

function TrendHead({ from, to, onInvert }: { from: string; to: string; onInvert: () => void }) {
  const a = CURRENCY_MAP[from];
  const b = CURRENCY_MAP[to];
  return (
    <div className="trend-head">
      <span className="pair-flags" aria-hidden="true">
        <Flag code={from} size={30} />
        <Flag code={to} size={30} />
      </span>
      <span className="pair-text">
        <span className="pair-code">
          {from} / {to}
        </span>
        <span className="pair-name">
          {a?.name}兑{b?.name}
        </span>
      </span>
      <button type="button" className="icon-btn" onClick={onInvert} aria-label={`反转为 ${to}/${from}`} title="反转货币对">
        <ArrowLeftRight size={18} />
      </button>
    </div>
  );
}

function TrendBody({ from, to }: { from: string; to: string }) {
  const [range, setRange] = useState<Range>('3m');
  const [hover, setHover] = useState<number | null>(null);
  const { load, retry } = useHistory(from, to, range);
  const data = load.data;
  const info = rangeInfo(range);

  useEffect(() => setHover(null), [range, from, to]);

  const candles = data?.candles ?? [];
  const n = candles.length;
  const last = candles[n - 1];
  const first = candles[0];
  const k = hover !== null ? candles[hover] : last;
  const ki = hover !== null ? hover : n - 1;
  const prevClose = ki > 0 ? candles[ki - 1].c : undefined;
  const kChg = k ? changePct(k.c, prevClose) : null;
  const rangeChg = last && first ? changePct(last.c, first.c) : null;
  const hi = n ? Math.max(...candles.map((c) => c.h)) : NaN;
  const lo = n ? Math.min(...candles.map((c) => c.l)) : NaN;
  const dir = (p: number | null) => (p === null || formatPct(p) === '0.00%' ? 'flat' : p > 0 ? 'up' : 'down');

  return (
    <div className="trend">
      <div className="trend-price">
        <span className="trend-last">{last ? formatRate(last.c) : '—'}</span>
        {rangeChg !== null && <span className={`chg chg-${dir(rangeChg)}`}>{formatPct(rangeChg)}</span>}
        <span className="trend-span">近{info.label}</span>
      </div>
      <p className="trend-desc">
        1 {from} = {last ? formatRate(last.c) : '—'} {to}
        {n > 0 && (
          <>
            {' '}
            · 最高 {formatRate(hi)} · 最低 {formatRate(lo)}
          </>
        )}
      </p>

      <div className="seg trend-ranges" role="radiogroup" aria-label="时间范围">
        {RANGES.map((r) => (
          <button key={r.id} type="button" role="radio" aria-checked={range === r.id} className={range === r.id ? 'is-on' : ''} onClick={() => setRange(r.id)}>
            {r.label}
          </button>
        ))}
      </div>

      <div className="ohlc" aria-live="polite">
        {k ? (
          <>
            <span className="ohlc-date">{dateLabel(k.t, data!.interval, true)}</span>
            <span>
              开 <b>{formatRate(k.o)}</b>
            </span>
            <span>
              高 <b>{formatRate(k.h)}</b>
            </span>
            <span>
              低 <b>{formatRate(k.l)}</b>
            </span>
            <span>
              收 <b>{formatRate(k.c)}</b>
            </span>
            {kChg !== null && <span className={`chg chg-${dir(kChg)}`}>{formatPct(kChg)}</span>}
          </>
        ) : (
          <span className="ohlc-date">&nbsp;</span>
        )}
      </div>

      <div className={`chart-area${load.state === 'loading' && !data ? ' is-loading' : ''}`}>
        {data && n >= 2 ? (
          <Chart candles={candles} interval={data.interval} hover={hover} onHover={setHover} />
        ) : load.state === 'error' ? (
          <div className="chart-msg">
            <p>暂时无法获取走势数据</p>
            {__SINGLE_FILE__ && __LIVE_URL__ ? (
              <p className="hint">
                当前页面不能联网，可以在
                <a href={__LIVE_URL__} target="_blank" rel="noreferrer">
                  在线版
                </a>
                查看走势。
              </p>
            ) : null}
            <button type="button" className="btn" onClick={retry}>
              <RefreshCw size={15} /> 重试
            </button>
          </div>
        ) : (
          <div className="chart-msg">
            <RefreshCw size={18} className="spin" />
            <span>正在加载走势…</span>
          </div>
        )}
      </div>

      {data && (
        <div className="trend-foot">
          <span className="legend">
            <span className="lg lg-up">{data.interval === '1d' ? '日K' : info.kLabel}</span>
            {n >= 8 && <span className="lg lg-ma5">MA5</span>}
            {n >= 25 && <span className="lg lg-ma20">MA20</span>}
          </span>
          <span className="src">
            {load.state === 'loading' ? '更新中…' : load.state === 'error' ? `离线 · ${formatAgo(data.fetchedAt)}的数据` : data.source}
          </span>
        </div>
      )}
      <p className="hint trend-note">
        红涨绿跌。{data && !data.ohlc ? '这个货币对只有每日收盘价，每根K线的开盘价取前一根的收盘价。' : ''}在图表上左右拖动（电脑上移动鼠标）查看每个时间点的价格。行情仅供参考。
      </p>
    </div>
  );
}
