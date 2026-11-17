import { CalendarClock, Hash, Plus, Repeat, UserRound } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { todayISO } from '../lib/date';
import { parseQuickInput, type ParsedInput, type ParsedToken } from '../lib/parse';
import { QMAP } from '../lib/quadrants';
import type { QuadrantId } from '../lib/types';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';

const TOKEN_ICON: Partial<Record<ParsedToken['kind'], typeof Hash>> = {
  tag: Hash,
  date: CalendarClock,
  time: CalendarClock,
  repeat: Repeat,
  delegate: UserRound,
};

export function TokenChips({ tokens }: { tokens: ParsedToken[] }) {
  if (!tokens.length) return null;
  return (
    <div className="tokens" aria-live="polite">
      {tokens.map((t, i) => {
        const Icon = TOKEN_ICON[t.kind];
        return (
          <span key={i} className={`token token-${t.kind}`}>
            {Icon && <Icon aria-hidden />}
            {t.label}
          </span>
        );
      })}
    </div>
  );
}

/** 解析输入，未开启智能识别时只取标题 */
export function useParsed(text: string, smart: boolean): ParsedInput {
  return useMemo(
    () => (smart ? parseQuickInput(text, todayISO()) : { title: text.trim(), tags: [], tokens: [] }),
    [text, smart],
  );
}

export function addFromParsed(p: ParsedInput, fallbackQ: QuadrantId, extra: { due?: string } = {}) {
  const quadrant = p.quadrant ?? fallbackQ;
  const id = useStore.getState().addTask({
    title: p.title,
    quadrant,
    tags: p.tags,
    delegate: p.delegate,
    due: p.due ?? extra.due,
    dueTime: p.dueTime,
    repeat: p.repeat,
  });
  if (quadrant !== fallbackQ) {
    useUI.getState().toast({ text: `已添加到 ${QMAP[quadrant].code} · ${QMAP[quadrant].verb}` }, 2500);
  }
  return id;
}

export function QuickAdd({ quadrant }: { quadrant: QuadrantId }) {
  const [text, setText] = useState('');
  const smart = useStore((s) => s.prefs.smartParse);
  const parsed = useParsed(text, smart);
  const id = useId();
  const m = QMAP[quadrant];
  const submit = () => {
    if (!parsed.title) return;
    addFromParsed(parsed, quadrant);
    setText('');
  };
  return (
    <form
      className="quick-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <label htmlFor={id} className="sr-only">
        添加任务到{m.verb}
      </label>
      <Plus aria-hidden className="quick-add-icon" />
      <input
        id={id}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setText('');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder={`添加到“${m.verb}”，回车保存`}
        autoComplete="off"
        enterKeyHint="done"
      />
      {text && <TokenChips tokens={parsed.tokens} />}
    </form>
  );
}
