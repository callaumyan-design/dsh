import { useEffect, useState } from 'react';
import { addDays, formatDue, startOfWeek, todayISO } from '../lib/date';
import { QMAP } from '../lib/quadrants';
import type { QuadrantId } from '../lib/types';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { TokenChips, addFromParsed, useParsed } from './QuickAdd';
import { Modal, QuadrantPicker } from './ui';

export function AddDialog() {
  const open = useUI((s) => s.dialog === 'add');
  const defaults = useUI((s) => s.addDefaults);
  const close = useUI((s) => s.openDialog);
  const toast = useUI((s) => s.toast);
  const smart = useStore((s) => s.prefs.smartParse);
  const setPrefs = useStore((s) => s.setPrefs);
  const [text, setText] = useState('');
  const [q, setQ] = useState<QuadrantId>('q2');
  const [due, setDue] = useState('');
  const [keepOpen, setKeepOpen] = useState(false);
  const parsed = useParsed(text, smart);

  useEffect(() => {
    if (open) {
      setText('');
      setQ(defaults?.quadrant ?? 'q2');
      setDue(defaults?.due ?? '');
    }
  }, [open, defaults]);

  const effectiveQ = parsed.quadrant ?? q;
  const effectiveDue = parsed.due ?? due;
  const today = todayISO();
  const m = QMAP[effectiveQ];
  const onClose = () => close(null);

  const submit = () => {
    if (!parsed.title) return;
    addFromParsed({ ...parsed, quadrant: effectiveQ }, effectiveQ, { due: due || undefined });
    if (keepOpen) {
      setText('');
      toast({ text: `已添加到 ${m.code} · ${m.verb}`, tone: 'success' }, 1800);
    } else {
      onClose();
      toast({ text: `已添加到 ${m.code} · ${m.verb}`, tone: 'success' }, 2500);
    }
  };

  const quickDates: { label: string; value: string }[] = [
    { label: '今天', value: today },
    { label: '明天', value: addDays(today, 1) },
    { label: '本周五', value: addDays(startOfWeek(today), 4) },
    { label: '下周一', value: addDays(startOfWeek(today), 7) },
  ].filter((d) => d.value >= today);

  return (
    <Modal open={open} onClose={onClose} title="新建任务" className="add-dialog">
      <form
        id="add-form"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="field-label" htmlFor="add-title">
          要做什么？
        </label>
        <input
          id="add-title"
          className="add-input"
          data-autofocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="例如：明天下午3点 提交周报 #工作"
          autoComplete="off"
          enterKeyHint="done"
        />
        <div className="add-preview">
          {smart && parsed.tokens.length > 0 ? (
            <TokenChips tokens={parsed.tokens} />
          ) : (
            <p className="field-help">
              {smart ? '可直接输入 明天、周五 15:00、每周一、#标签、@委托人、!1–!4 指定象限' : '智能识别已关闭，输入内容将原样作为标题'}
            </p>
          )}
        </div>

        <div className="add-grid">
          <div>
            <div className="field-label">放进哪个象限？</div>
            <QuadrantPicker value={effectiveQ} onChange={setQ} />
            <p className="field-help add-hint">{m.hint}</p>
          </div>
          <div className="add-side">
            <div className="field-label">截止日期</div>
            <div className="chip-row">
              {quickDates.map((d) => (
                <button
                  key={d.label}
                  type="button"
                  className={`chip${effectiveDue === d.value ? ' is-on' : ''}`}
                  onClick={() => setDue(due === d.value ? '' : d.value)}
                >
                  {d.label}
                </button>
              ))}
            </div>
            <input
              id="add-due"
              type="date"
              className="input"
              aria-label="选择截止日期"
              value={effectiveDue}
              onChange={(e) => setDue(e.target.value)}
            />
            {effectiveDue && <p className="field-help">截止：{formatDue(effectiveDue, today, parsed.dueTime)}</p>}
            <label className="check-line">
              <input id="add-smart" type="checkbox" checked={smart} onChange={(e) => setPrefs({ smartParse: e.target.checked })} />
              智能识别日期和标签
            </label>
            <label className="check-line">
              <input id="add-keep" type="checkbox" checked={keepOpen} onChange={(e) => setKeepOpen(e.target.checked)} />
              添加后继续新建
            </label>
          </div>
        </div>
      </form>
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>
          取消
        </button>
        <button type="submit" form="add-form" className={`btn primary q-${effectiveQ}`} disabled={!parsed.title}>
          添加到 {m.code} {m.verb}
        </button>
      </div>
    </Modal>
  );
}
