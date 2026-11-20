import { Delete } from 'lucide-react';
import type { Key } from '../lib/calc';

interface KeyDef {
  k: Key;
  label: string;
  aria: string;
  kind: 'num' | 'op' | 'fn' | 'eq';
  area: string;
}

const KEYS: KeyDef[] = [
  { k: '7', label: '7', aria: '7', kind: 'num', area: 'k7' },
  { k: '8', label: '8', aria: '8', kind: 'num', area: 'k8' },
  { k: '9', label: '9', aria: '9', kind: 'num', area: 'k9' },
  { k: '/', label: '÷', aria: '除', kind: 'op', area: 'div' },
  { k: 'back', label: '', aria: '退格', kind: 'fn', area: 'back' },
  { k: '4', label: '4', aria: '4', kind: 'num', area: 'k4' },
  { k: '5', label: '5', aria: '5', kind: 'num', area: 'k5' },
  { k: '6', label: '6', aria: '6', kind: 'num', area: 'k6' },
  { k: '*', label: '×', aria: '乘', kind: 'op', area: 'mul' },
  { k: 'clear', label: 'C', aria: '清零', kind: 'fn', area: 'clr' },
  { k: '1', label: '1', aria: '1', kind: 'num', area: 'k1' },
  { k: '2', label: '2', aria: '2', kind: 'num', area: 'k2' },
  { k: '3', label: '3', aria: '3', kind: 'num', area: 'k3' },
  { k: '-', label: '−', aria: '减', kind: 'op', area: 'sub' },
  { k: '=', label: '=', aria: '等于', kind: 'eq', area: 'eq' },
  { k: '0', label: '0', aria: '0', kind: 'num', area: 'k0' },
  { k: '00', label: '00', aria: '00', kind: 'num', area: 'k00' },
  { k: '.', label: '.', aria: '小数点', kind: 'num', area: 'dot' },
  { k: '+', label: '+', aria: '加', kind: 'op', area: 'add' },
];

export function Keypad({ onKey }: { onKey: (k: Key) => void }) {
  return (
    <div className="keypad" role="group" aria-label="数字键盘">
      {KEYS.map((d) => (
        <button
          key={d.area}
          type="button"
          className={`key key-${d.kind}`}
          style={{ gridArea: d.area }}
          aria-label={d.aria}
          data-key={d.k}
          // 用 pointerdown 响应更快；键盘操作（Enter/空格）走 click
          onPointerDown={(e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            e.preventDefault();
            onKey(d.k);
          }}
          onClick={(e) => {
            if (e.detail === 0) onKey(d.k);
          }}
        >
          {d.k === 'back' ? <Delete size={22} strokeWidth={1.75} /> : d.label}
        </button>
      ))}
    </div>
  );
}
