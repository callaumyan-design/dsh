// 输入框里的算式：数字和 + - * /（显示为 + − × ÷）。所有函数都是纯函数，方便测试。

export type Op = '+' | '-' | '*' | '/';
export type Key = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | Op | 'back' | 'clear' | '=';

export interface InputState {
  expr: string;
  /** 刚切换货币或按过 =：下一次输入数字会替换整个算式 */
  fresh: boolean;
}

const OPS = '+-*/';
const MAX_EXPR = 40;
const MAX_DIGITS = 15;

export const isOp = (ch: string): ch is Op => ch.length === 1 && OPS.includes(ch);
export const hasOperator = (expr: string) => /[0-9.][+\-*/]/.test(expr);

/** 算式最后一个数字（可能为空串，比如刚输入了运算符） */
function lastNumber(expr: string): string {
  const m = expr.match(/[0-9.]*$/);
  return m ? m[0] : '';
}

export function press(state: InputState, key: Key): InputState {
  let { expr } = state;
  const { fresh } = state;

  if (key === 'clear') return { expr: '', fresh: false };

  if (key === 'back') return { expr: expr.slice(0, -1), fresh: false };

  if (key === '=') {
    const v = evaluate(expr);
    if (v === null) return { expr, fresh: true };
    return { expr: toPlain(v), fresh: true };
  }

  if (isOp(key)) {
    if (expr === '' || expr === '-') return { expr, fresh: false };
    if (expr.endsWith('.')) expr = expr.slice(0, -1);
    if (isOp(expr[expr.length - 1])) expr = expr.slice(0, -1);
    if (expr.length >= MAX_EXPR) return { expr, fresh: false };
    return { expr: expr + key, fresh: false };
  }

  // 数字、00 和小数点
  if (fresh) expr = '';
  const num = lastNumber(expr);
  if (expr.length >= MAX_EXPR) return { expr, fresh: false };

  if (key === '.') {
    if (num.includes('.')) return { expr, fresh: false };
    return { expr: expr + (num === '' ? '0.' : '.'), fresh: false };
  }

  const digits = num.replace('.', '').length;
  if (digits >= MAX_DIGITS) return { expr, fresh: false };

  if (key === '00') {
    if (num === '' || num === '0') return { expr: num === '' ? expr + '0' : expr, fresh: false };
    return { expr: expr + (digits + 2 > MAX_DIGITS ? '0' : '00'), fresh: false };
  }

  // 去掉前导零：0 后面再输入数字时替换掉这个 0
  if (num === '0') return { expr: expr.slice(0, -1) + key, fresh: false };
  return { expr: expr + key, fresh: false };
}

/** 计算算式；空串记为 0，末尾多余的运算符或小数点会被忽略；无法计算（如除以 0）返回 null */
export function evaluate(expr: string): number | null {
  let s = expr.trim();
  while (s && (isOp(s[s.length - 1]) || s.endsWith('.'))) s = s.slice(0, -1);
  if (s === '' || s === '-') return 0;
  // 按过 = 之后结果可能是负数，开头的负号当作 0 - x
  if (s.startsWith('-')) s = '0' + s;
  const tokens = s.match(/\d*\.?\d+|\d+\.|[+\-*/]/g);
  if (!tokens || tokens.join('') !== s) return null;

  // 先算乘除，再算加减
  const terms: number[] = [];
  const addOps: Op[] = [];
  let cur: number | null = null;
  let pending: Op | null = null;
  for (const t of tokens) {
    if (isOp(t)) {
      if (cur === null) return null;
      if (t === '+' || t === '-') {
        terms.push(cur);
        addOps.push(t);
        cur = null;
        pending = null;
      } else {
        pending = t;
      }
      continue;
    }
    const n = parseFloat(t);
    if (!Number.isFinite(n)) return null;
    if (pending && cur !== null) {
      cur = pending === '*' ? cur * n : cur / n;
      pending = null;
    } else {
      cur = n;
    }
  }
  if (cur === null) return null;
  terms.push(cur);
  let total = terms[0];
  for (let i = 0; i < addOps.length; i++) total = addOps[i] === '+' ? total + terms[i + 1] : total - terms[i + 1];
  return Number.isFinite(total) ? total : null;
}

/** 把数字写成不带科学计数法的字符串，去掉浮点误差，最多 10 位小数 */
export function toPlain(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const clean = Number(n.toPrecision(12));
  let s = clean.toFixed(10).replace(/\.?0+$/, '');
  if (s === '-0') s = '0';
  return s;
}
