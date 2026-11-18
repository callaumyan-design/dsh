import { TriangleAlert } from 'lucide-react';
import { DEFAULT_COLORS, PALETTES, effectiveColors, similarPairs } from '../lib/color';
import { QMAP, QUADRANTS } from '../lib/quadrants';
import type { QuadrantId } from '../lib/types';
import { useStore } from '../store/useStore';

/** 设置里的“象限颜色”：预设配色 + 每个象限单独取色 */
export function ColorSettings() {
  const custom = useStore((s) => s.prefs.colors);
  const setPrefs = useStore((s) => s.setPrefs);
  const eff = effectiveColors(custom);
  const customized = Object.keys(custom).length > 0;
  const similar = similarPairs(eff);

  const setColor = (q: QuadrantId, hex: string) => {
    const next = { ...custom, [q]: hex.toLowerCase() };
    if (next[q] === DEFAULT_COLORS[q]) delete next[q];
    setPrefs({ colors: next });
  };
  const resetOne = (q: QuadrantId) => {
    const next = { ...custom };
    delete next[q];
    setPrefs({ colors: next });
  };
  const paletteOn = (colors: Record<QuadrantId, string>) => QUADRANTS.every((q) => eff[q.id] === colors[q.id]);

  return (
    <div className="color-settings" id="set-colors">
      <div>
        <div className="setting-title">象限颜色</div>
        <div className="setting-desc">选一套配色，或点色块单独给某个象限换颜色。文字和背景会自动调整深浅，保证看得清。</div>
      </div>

      <div className="palette-row" role="radiogroup" aria-label="配色方案">
        {PALETTES.map((p) => {
          const on = paletteOn(p.colors);
          return (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`palette-chip${on ? ' is-on' : ''}`}
              onClick={() => {
                const next: Partial<Record<QuadrantId, string>> = {};
                for (const q of QUADRANTS) if (p.colors[q.id] !== DEFAULT_COLORS[q.id]) next[q.id] = p.colors[q.id];
                setPrefs({ colors: next });
              }}
            >
              <span className="palette-dots" aria-hidden>
                {QUADRANTS.map((q) => (
                  <i key={q.id} style={{ background: p.colors[q.id] }} />
                ))}
              </span>
              {p.name}
            </button>
          );
        })}
      </div>

      <ul className="color-list">
        {QUADRANTS.map((q) => (
          <li key={q.id} className={`color-row q-${q.id}`}>
            <span className={`qbadge q-${q.id}`}>
              <b>{q.code}</b>
              <span>{q.verb}</span>
            </span>
            <label className="color-swatch" style={{ background: eff[q.id] }} title="点击选择颜色">
              <input
                id={`set-color-${q.id}`}
                type="color"
                value={eff[q.id]}
                aria-label={`${q.code} ${q.verb} 的颜色`}
                onChange={(e) => setColor(q.id, e.target.value)}
              />
            </label>
            <span className="color-hex">{eff[q.id]}</span>
            {custom[q.id] && (
              <button type="button" className="link-btn" onClick={() => resetOne(q.id)}>
                恢复默认
              </button>
            )}
          </li>
        ))}
      </ul>

      {similar.length > 0 && (
        <p className="color-warn" role="status">
          <TriangleAlert aria-hidden />
          {similar.map(([a, b]) => `${QMAP[a].code} 和 ${QMAP[b].code}`).join('、')} 的颜色太接近，可能不容易区分。
        </p>
      )}

      {customized && (
        <div>
          <button type="button" className="btn sm" onClick={() => setPrefs({ colors: {} })}>
            全部恢复默认配色
          </button>
        </div>
      )}
    </div>
  );
}
