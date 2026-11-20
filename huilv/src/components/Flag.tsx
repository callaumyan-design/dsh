import { CURRENCY_MAP } from '../lib/currencies';
import { FLAGS } from '../data/flags';

/** 圆形国旗；黄金、白银、加密货币用符号徽章 */
export function Flag({ code, size = 36 }: { code: string; size?: number }) {
  const c = CURRENCY_MAP[code];
  const src = c?.flag ? FLAGS[c.flag] : undefined;
  if (src) return <img className="flag" src={src} width={size} height={size} alt="" draggable={false} />;
  const glyph = code === 'XAU' ? 'Au' : code === 'XAG' ? 'Ag' : (c?.symbol ?? code.slice(0, 2));
  return (
    <span className={`flag badge badge-${code.toLowerCase()}`} style={{ width: size, height: size }} aria-hidden="true">
      {glyph}
    </span>
  );
}
