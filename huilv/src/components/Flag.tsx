import type { CSSProperties } from 'react';
import { CURRENCY_MAP } from '../lib/currencies';
import { FLAG_COLS, FLAG_INDEX, FLAG_ROWS, FLAG_SPRITE } from '../data/flags';

// 所有国旗在一张雪碧图里，只注入一次
if (typeof document !== 'undefined' && !document.getElementById('flag-sprite')) {
  const style = document.createElement('style');
  style.id = 'flag-sprite';
  style.textContent = `.flag-img{background-image:url("${FLAG_SPRITE}");background-size:${FLAG_COLS * 100}% ${FLAG_ROWS * 100}%}`;
  document.head.appendChild(style);
}

/** 圆形国旗；黄金、白银、加密货币用符号徽章 */
export function Flag({ code, size = 36 }: { code: string; size?: number }) {
  const c = CURRENCY_MAP[code];
  const i = c?.flag ? FLAG_INDEX[c.flag] : undefined;
  if (i !== undefined) {
    const col = i % FLAG_COLS;
    const row = Math.floor(i / FLAG_COLS);
    const style: CSSProperties = {
      width: size,
      height: size,
      backgroundPosition: `${(col / (FLAG_COLS - 1)) * 100}% ${(row / (FLAG_ROWS - 1)) * 100}%`,
    };
    return <span className="flag flag-img" style={style} aria-hidden="true" />;
  }
  const glyph = code === 'XAU' ? 'Au' : code === 'XAG' ? 'Ag' : (c?.symbol ?? code.slice(0, 2));
  return (
    <span className={`flag badge badge-${code.toLowerCase()}`} style={{ width: size, height: size }} aria-hidden="true">
      {glyph}
    </span>
  );
}
