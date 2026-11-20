import { useMemo, useState } from 'react';
import { Check, Search } from 'lucide-react';
import { CURRENCIES, searchCurrencies, type Currency } from '../lib/currencies';
import { useStore } from '../store';
import { Flag } from './Flag';
import { Sheet } from './Sheet';

export function Picker({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState('');
  const list = useStore((s) => s.list);
  const rates = useStore((s) => s.rates.rates);
  const toggle = useStore((s) => s.toggle);

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
    const last = on && list.length <= 1;
    return (
      <li key={c.code}>
        <button
          type="button"
          className={`pick${on ? ' is-on' : ''}`}
          onClick={() => toggle(c.code)}
          disabled={(missing && !on) || last}
          aria-pressed={on}
        >
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

  return (
    <Sheet
      open={open}
      title="添加货币"
      onClose={close}
      footer={
        <div className="sheet-foot">
          <span>已选 {list.length} 种</span>
          <button type="button" className="btn-primary" onClick={close}>
            完成
          </button>
        </div>
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
