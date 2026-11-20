import { useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Search } from 'lucide-react';
import { CURRENCIES, CURRENCY_MAP, searchCurrencies, type Currency } from '../lib/currencies';
import { useStore } from '../store';
import { Flag } from './Flag';
import { Sheet } from './Sheet';

/**
 * 选择货币。
 * - 添加模式（replace 为空）：点一下加入或移出列表
 * - 更换模式（replace 为某个代码）：点一下把那一行换成选中的货币，然后关闭
 */
export function Picker({ open, onClose, replace }: { open: boolean; onClose: () => void; replace?: string | null }) {
  const [q, setQ] = useState('');
  const list = useStore((s) => s.list);
  const rates = useStore((s) => s.rates.rates);
  const toggle = useStore((s) => s.toggle);
  const replaceCode = useStore((s) => s.replace);

  const close = () => {
    setQ('');
    onClose();
  };

  const groups = useMemo(() => {
    if (q.trim()) return [{ title: '', items: searchCurrencies(q) }];
    return [
      { title: '常用', items: CURRENCIES.filter((c) => c.common) },
      { title: '贵金属与加密货币', items: CURRENCIES.filter((c) => !c.flag) },
      { title: '更多', items: CURRENCIES.filter((c) => !c.common && c.flag) },
    ];
  }, [q]);

  const item = (c: Currency) => {
    const on = list.includes(c.code);
    const missing = !rates[c.code];
    if (replace) {
      const current = c.code === replace;
      return (
        <li key={c.code}>
          <button
            type="button"
            className={`pick${current ? ' is-on' : ''}`}
            disabled={current || (missing && !on)}
            onClick={() => {
              replaceCode(replace, c.code);
              close();
            }}
          >
            <Flag code={c.code} size={32} />
            <span className="pick-text">
              <span className="pick-title">
                <b>{c.code}</b> {c.name}
              </span>
              <span className="pick-sub">{current ? '当前' : on ? '已在列表中 · 点按交换位置' : missing ? '暂无汇率' : `${c.region} · ${c.en}`}</span>
            </span>
            <span className={`pick-check${on && !current ? ' is-swap' : ''}`} aria-hidden="true">
              {current ? <Check size={15} strokeWidth={3} /> : on ? <ArrowLeftRight size={13} strokeWidth={2.5} /> : null}
            </span>
          </button>
        </li>
      );
    }
    const last = on && list.length <= 1;
    return (
      <li key={c.code}>
        <button type="button" className={`pick${on ? ' is-on' : ''}`} onClick={() => toggle(c.code)} disabled={(missing && !on) || last} aria-pressed={on}>
          <Flag code={c.code} size={32} />
          <span className="pick-text">
            <span className="pick-title">
              <b>{c.code}</b> {c.name}
            </span>
            <span className="pick-sub">{missing ? '暂无汇率' : `${c.region} · ${c.en}`}</span>
          </span>
          <span className="pick-check" aria-hidden="true">
            {on && <Check size={15} strokeWidth={3} />}
          </span>
        </button>
      </li>
    );
  };

  const empty = groups.every((g) => g.items.length === 0);
  const title = replace ? `把 ${replace} ${CURRENCY_MAP[replace]?.name ?? ''}换成` : '添加货币';

  return (
    <Sheet
      open={open}
      title={title}
      onClose={close}
      footer={
        replace ? undefined : (
          <div className="sheet-foot">
            <span>已选 {list.length} 种</span>
            <button type="button" className="btn-primary" onClick={close}>
              完成
            </button>
          </div>
        )
      }
    >
      <label className="search">
        <Search size={17} aria-hidden="true" />
        <input
          id="currency-search"
          data-autofocus
          type="search"
          placeholder="搜索：美元、USD、meiyuan、my"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </label>
      {empty && <p className="empty">没有找到“{q}”，试试货币代码或中文名。</p>}
      {groups.map((g) =>
        g.items.length ? (
          <section key={g.title || 'results'} className="pick-group">
            {g.title && <h3>{g.title}</h3>}
            <ul>{g.items.map(item)}</ul>
          </section>
        ) : null,
      )}
    </Sheet>
  );
}
