import { CircleCheck, ClipboardCopy, Download, MonitorSmartphone, Upload, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { copyText, downloadText } from '../actions';
import { useInstallPrompt, useIsMobile } from '../hooks';
import { todayISO } from '../lib/date';
import { QUADRANTS } from '../lib/quadrants';
import { buildExport, buildMarkdown, parseImport } from '../lib/storage';
import type { Task } from '../lib/types';
import { useStore } from '../store/useStore';
import { useUI } from '../store/useUI';
import { ColorSettings } from './ColorSettings';
import { Modal, QBadge, Segmented, Switch } from './ui';

export function ConfirmDialog() {
  const c = useUI((s) => s.confirm);
  const ask = useUI((s) => s.askConfirm);
  if (!c) return null;
  const close = () => ask(null);
  return (
    <Modal open onClose={close} title={c.title} className="confirm-dialog">
      {c.body && <p className="confirm-body">{c.body}</p>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={close}>
          取消
        </button>
        <button
          type="button"
          data-autofocus
          className={`btn ${c.danger ? 'danger' : 'primary'}`}
          onClick={() => {
            close();
            c.onConfirm();
          }}
        >
          {c.confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismissToast);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone ?? 'default'}`}>
          {t.tone === 'success' && <CircleCheck aria-hidden className="toast-icon" />}
          <span className="toast-text">{t.text}</span>
          {t.action && (
            <button
              type="button"
              className="toast-action"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button type="button" className="toast-close" aria-label="关闭提示" onClick={() => dismiss(t.id)}>
            <X />
          </button>
        </div>
      ))}
    </div>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['N'], '新建任务'],
  [['/'], '搜索'],
  [['M'], '矩阵视图'],
  [['A'], '日程视图'],
  [['S'], '统计视图'],
  [['F'], '专注 / 退出专注当前象限'],
  [['Ctrl', 'Z'], '撤销'],
  [['Ctrl', 'Shift', 'Z'], '重做'],
  [['?'], '显示快捷键'],
  [['Esc'], '关闭面板 / 退出专注'],
];

const CARD_SHORTCUTS: [string[], string][] = [
  [['Enter'], '打开详情'],
  [['空格'], '完成 / 取消完成'],
  [['1', '–', '4'], '移动到对应象限'],
  [['↑', '↓'], '在任务间切换'],
  [['Alt', '↑ / ↓'], '调整顺序'],
  [['D'], '创建副本'],
  [['Delete'], '删除'],
];

function KeyList({ items }: { items: [string[], string][] }) {
  return (
    <dl className="keys">
      {items.map(([keys, label]) => (
        <div key={label}>
          <dt>
            {keys.map((k, i) => (k === '–' ? <span key={i}>–</span> : <kbd key={i}>{k}</kbd>))}
          </dt>
          <dd>{label}</dd>
        </div>
      ))}
    </dl>
  );
}

const GESTURES: [string, string][] = [
  ['点击卡片', '打开详情，编辑日期、标签、子任务和备注'],
  ['点击圆圈', '完成任务；底部提示条里可以撤销'],
  ['长按卡片后拖动', '移到其他象限或调整顺序'],
  ['点击象限标题', '专注查看这个象限，可把任务拖到下方的其他象限'],
  ['“升到 Q1”', '第二象限任务临近截止时出现，一键移到“立即做”'],
];

export function ShortcutsDialog() {
  const open = useUI((s) => s.dialog === 'shortcuts');
  const close = useUI((s) => s.openDialog);
  const mobile = useIsMobile();
  return (
    <Modal open={open} onClose={() => close(null)} title={mobile ? '使用帮助' : '使用帮助与快捷键'} className="shortcuts-dialog">
      <section className="help-quads">
        {QUADRANTS.map((q) => (
          <div key={q.id} className={`help-quad q-${q.id}`}>
            <div className="help-quad-head">
              <QBadge q={q.id} />
              <span>{q.title}</span>
            </div>
            <p>{q.hint}</p>
          </div>
        ))}
      </section>
      {mobile ? (
        <section className="help-gestures">
          <h3>操作</h3>
          <dl className="keys">
            {GESTURES.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : (
        <div className="keys-grid">
          <section>
            <h3>全局</h3>
            <KeyList items={SHORTCUTS} />
          </section>
          <section>
            <h3>选中任务卡片时</h3>
            <KeyList items={CARD_SHORTCUTS} />
            <p className="field-help">用鼠标拖动卡片可跨象限移动或排序。</p>
          </section>
        </div>
      )}
    </Modal>
  );
}

export function SettingsDialog() {
  const open = useUI((s) => s.dialog === 'settings');
  const close = useUI((s) => s.openDialog);
  const toast = useUI((s) => s.toast);
  const askConfirm = useUI((s) => s.askConfirm);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const tasks = useStore((s) => s.tasks);
  const importTasks = useStore((s) => s.importTasks);
  const removeSamples = useStore((s) => s.removeSamples);
  const loadSamples = useStore((s) => s.loadSamples);
  const resetAll = useStore((s) => s.resetAll);
  const install = useInstallPrompt();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pasteText, setPasteText] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const sampleCount = tasks.filter((t) => t.sample).length;

  const stamp = todayISO();

  const [pending, setPending] = useState<{ tasks: Task[]; skipped: number } | null>(null);
  const doImport = (text: string) => {
    try {
      const res = parseImport(text);
      if (!res.tasks.length) {
        toast({ text: '文件里没有可导入的任务。', tone: 'error' });
        return;
      }
      setPending(res);
    } catch (e) {
      toast({ text: (e as Error).message, tone: 'error' }, 6000);
    }
  };
  const undoAction = { label: '撤销', run: () => useStore.getState().undo() };
  const finishImport = (mode: 'merge' | 'replace') => {
    if (!pending) return;
    importTasks(pending.tasks, mode);
    toast({ text: mode === 'merge' ? `已合并导入 ${pending.tasks.length} 项任务` : '已替换为备份内容', tone: 'success', action: undoAction });
    setPending(null);
    setPasteText('');
    setShowPaste(false);
  };

  const exportJSON = async () => {
    const text = buildExport(tasks);
    setExported(text);
    // 嵌入在其他页面（iframe）中时浏览器通常会拦截下载，直接展示备份内容
    const embedded = window.top !== window.self;
    if (!embedded && downloadText(`四象限-备份-${stamp}.json`, text)) toast({ text: '已开始下载备份文件', tone: 'success' });
    else toast({ text: '当前页面无法直接下载，备份内容已显示在下方，可复制保存' }, 6000);
  };
  const copyJSON = async () => {
    const text = buildExport(tasks);
    setExported(text);
    toast(await copyText(text) ? { text: '备份 JSON 已复制到剪贴板', tone: 'success' } : { text: '复制失败，请在下方文本框中手动全选复制', tone: 'error' });
  };
  const copyMarkdown = async () => {
    const text = buildMarkdown(tasks, QUADRANTS);
    setExported(text);
    toast(await copyText(text) ? { text: 'Markdown 清单已复制', tone: 'success' } : { text: '复制失败，请在下方文本框中手动全选复制', tone: 'error' });
  };

  return (
    <Modal open={open} onClose={() => close(null)} title="设置" className="settings-dialog">
      <section className="settings-group">
        <h3>外观</h3>
        <div className="setting-row">
          <div>
            <div className="setting-title">主题</div>
          </div>
          <Segmented
            label="主题"
            value={prefs.theme}
            onChange={(theme) => setPrefs({ theme })}
            options={[
              { value: 'system', label: '跟随系统' },
              { value: 'light', label: '浅色' },
              { value: 'dark', label: '深色' },
            ]}
          />
        </div>
        <div className="setting-row">
          <label htmlFor="set-done">
            <div className="setting-title">显示已完成任务</div>
            <div className="setting-desc">在每个象限底部折叠显示</div>
          </label>
          <Switch id="set-done" label="显示已完成任务" checked={prefs.showCompleted} onChange={(v) => setPrefs({ showCompleted: v })} />
        </div>
        <ColorSettings />
      </section>

      <section className="settings-group">
        <h3>智能功能</h3>
        <div className="setting-row">
          <label htmlFor="set-smart">
            <div className="setting-title">智能识别输入</div>
            <div className="setting-desc">自动识别“明天下午3点”“每周一”“#标签”“@人”“!1”等</div>
          </label>
          <Switch id="set-smart" label="智能识别输入" checked={prefs.smartParse} onChange={(v) => setPrefs({ smartParse: v })} />
        </div>
        <div className="setting-row">
          <label htmlFor="set-esc">
            <div className="setting-title">升级提醒</div>
            <div className="setting-desc">第二象限任务距截止不足几天时，提示移到“立即做”</div>
          </label>
          <select
            id="set-esc"
            className="input narrow"
            value={prefs.escalateDays}
            onChange={(e) => setPrefs({ escalateDays: Number(e.target.value) })}
          >
            <option value={0}>当天</option>
            <option value={1}>1 天</option>
            <option value={2}>2 天</option>
            <option value={3}>3 天</option>
            <option value={7}>7 天</option>
          </select>
        </div>
      </section>

      <section className="settings-group">
        <h3>数据</h3>
        <p className="setting-desc">任务只保存在这台设备的浏览器里。换设备或清理浏览器数据前，请先导出备份。</p>
        <div className="btn-row">
          <button type="button" className="btn" onClick={exportJSON}>
            <Download aria-hidden />
            下载备份
          </button>
          <button type="button" className="btn" onClick={copyJSON}>
            <ClipboardCopy aria-hidden />
            复制备份
          </button>
          <button type="button" className="btn" onClick={copyMarkdown}>
            <ClipboardCopy aria-hidden />
            复制为 Markdown
          </button>
        </div>
        {exported && (
          <textarea
            id="set-exported"
            className="input mono"
            readOnly
            rows={4}
            value={exported}
            aria-label="导出内容"
            onFocus={(e) => e.currentTarget.select()}
          />
        )}
        <div className="btn-row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()}>
            <Upload aria-hidden />
            从文件导入
          </button>
          <button type="button" className="btn ghost" onClick={() => setShowPaste((v) => !v)}>
            粘贴 JSON 导入
          </button>
          <input
            ref={fileRef}
            id="set-file"
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) doImport(await f.text());
            }}
          />
        </div>
        {showPaste && (
          <div className="paste-box">
            <textarea
              id="set-paste"
              className="input mono"
              rows={4}
              placeholder="把备份 JSON 粘贴到这里"
              value={pasteText}
              onChange={(e) => setPasteText(e.target.value)}
            />
            <button type="button" className="btn primary" disabled={!pasteText.trim()} onClick={() => doImport(pasteText)}>
              导入
            </button>
          </div>
        )}
        {pending && (
          <div className="import-confirm" role="group" aria-label="确认导入">
            <p>
              找到 <b>{pending.tasks.length}</b> 项任务{pending.skipped ? `，${pending.skipped} 条无效数据会被跳过` : ''}。
              合并会保留现有任务，并用较新的版本更新同一任务；替换会覆盖当前全部 {tasks.length} 项任务。
            </p>
            <div className="btn-row">
              <button type="button" className="btn primary" onClick={() => finishImport('merge')}>
                合并导入
              </button>
              <button
                type="button"
                className="btn danger-outline"
                onClick={() =>
                  askConfirm({
                    title: '用备份替换全部任务？',
                    body: `当前的 ${tasks.length} 项任务会被替换为备份中的 ${pending.tasks.length} 项。可以撤销。`,
                    confirmLabel: '替换',
                    danger: true,
                    onConfirm: () => finishImport('replace'),
                  })
                }
              >
                替换全部
              </button>
              <button type="button" className="btn ghost" onClick={() => setPending(null)}>
                取消
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="settings-group">
        <h3>示例与重置</h3>
        <div className="btn-row">
          {sampleCount > 0 ? (
            <button
              type="button"
              className="btn"
              onClick={() => {
                const n = removeSamples();
                toast({ text: `已移除 ${n} 项示例任务`, action: undoAction });
              }}
            >
              移除示例任务（{sampleCount}）
            </button>
          ) : (
            <button
              type="button"
              className="btn"
              onClick={() => {
                loadSamples();
                toast({ text: '已载入示例任务', action: undoAction });
              }}
            >
              载入示例任务
            </button>
          )}
          <button
            type="button"
            className="btn danger-outline"
            onClick={() =>
              askConfirm({
                title: '清空全部任务？',
                body: `将删除全部 ${tasks.length} 项任务（包括已完成的记录）。建议先导出备份。可以立即撤销。`,
                confirmLabel: '清空',
                danger: true,
                onConfirm: () => {
                  resetAll();
                  toast({ text: '已清空全部任务', action: undoAction });
                },
              })
            }
          >
            清空全部任务
          </button>
        </div>
      </section>

      {install && (
        <section className="settings-group">
          <h3>安装</h3>
          <div className="setting-row">
            <div>
              <div className="setting-title">安装到桌面 / 主屏幕</div>
              <div className="setting-desc">像原生应用一样独立打开，离线也能用</div>
            </div>
            <button type="button" className="btn primary" onClick={install}>
              <MonitorSmartphone aria-hidden />
              安装
            </button>
          </div>
        </section>
      )}
      <p className="about">四象限 · 任务计划 v1.0 · 数据仅保存在本地</p>
    </Modal>
  );
}
