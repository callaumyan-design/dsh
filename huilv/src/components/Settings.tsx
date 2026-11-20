import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useStore, type Theme } from '../store';
import type { Decimals } from '../lib/format';
import { formatAgo } from '../lib/format';
import { SOURCE_FAWAZ } from '../lib/rates';
import { Sheet } from './Sheet';

declare const __SINGLE_FILE__: boolean;
declare const __LIVE_URL__: string;

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
}

let deferredInstall: InstallPrompt | null = null;
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as InstallPrompt;
  });
}

function Segmented<T extends string | number>({ id, value, options, onChange }: { id: string; value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-labelledby={id}>
      {options.map((o) => (
        <button key={String(o.v)} type="button" role="radio" aria-checked={value === o.v} className={value === o.v ? 'is-on' : ''} onClick={() => onChange(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Settings({ open, onClose }: { open: boolean; onClose: () => void }) {
  const decimals = useStore((s) => s.decimals);
  const theme = useStore((s) => s.theme);
  const rates = useStore((s) => s.rates);
  const status = useStore((s) => s.status);
  const setDecimals = useStore((s) => s.setDecimals);
  const setTheme = useStore((s) => s.setTheme);
  const refresh = useStore((s) => s.refresh);
  const reset = useStore((s) => s.reset);
  const [confirmReset, setConfirmReset] = useState(false);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmReset(false);
      setCanInstall(!!deferredInstall);
    }
  }, [open]);

  const sourceName = rates.source === SOURCE_FAWAZ ? 'fawazahmed0 Exchange API（每日更新）' : rates.source;

  return (
    <Sheet open={open} title="设置" onClose={onClose}>
      <div className="set-group">
        <h3 id="set-decimals">小数位数</h3>
        <Segmented<Decimals>
          id="set-decimals"
          value={decimals}
          onChange={setDecimals}
          options={[
            { v: 'auto', label: '自动' },
            { v: 0, label: '0' },
            { v: 2, label: '2' },
            { v: 4, label: '4' },
          ]}
        />
        <p className="hint">自动：一般保留两位小数，小于 1 的金额保留四位有效数字。</p>
      </div>

      <div className="set-group">
        <h3 id="set-theme">外观</h3>
        <Segmented<Theme>
          id="set-theme"
          value={theme}
          onChange={setTheme}
          options={[
            { v: 'system', label: '跟随系统' },
            { v: 'light', label: '浅色' },
            { v: 'dark', label: '深色' },
          ]}
        />
      </div>

      <div className="set-group">
        <h3>汇率数据</h3>
        <dl className="facts">
          <div>
            <dt>汇率日期</dt>
            <dd>{rates.date}</dd>
          </div>
          <div>
            <dt>获取时间</dt>
            <dd>{rates.fetchedAt ? formatAgo(rates.fetchedAt) : '应用内置'}</dd>
          </div>
          <div>
            <dt>来源</dt>
            <dd>{sourceName}</dd>
          </div>
        </dl>
        <button type="button" className="btn" onClick={() => refresh({ force: true })} disabled={status === 'loading'}>
          <RefreshCw size={16} className={status === 'loading' ? 'spin' : ''} />
          {status === 'loading' ? '正在更新…' : '立即更新'}
        </button>
        <p className="hint">参考汇率为市场中间价，和银行、换汇机构的买入卖出价会有差别。</p>
      </div>

      <div className="set-group">
        <h3>用法</h3>
        <ul className="tips">
          <li>点任意一行，把它设为要输入的货币</li>
          <li>长按一行（电脑上右键）复制金额</li>
          <li>可以直接算：100 × 3 + 25</li>
          <li>电脑上可以用键盘输入，↑ ↓ 切换货币，Esc 清零</li>
        </ul>
      </div>

      {(canInstall || __SINGLE_FILE__) && (
        <div className="set-group">
          <h3>安装</h3>
          {canInstall && (
            <button
              type="button"
              className="btn"
              onClick={async () => {
                await deferredInstall?.prompt();
                deferredInstall = null;
                setCanInstall(false);
              }}
            >
              安装到桌面 / 主屏幕
            </button>
          )}
          {__SINGLE_FILE__ && __LIVE_URL__ && (
            <p className="hint">
              在线版可以实时更新汇率，也能添加到手机主屏幕：
              <a href={__LIVE_URL__} target="_blank" rel="noreferrer">
                {__LIVE_URL__.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </a>
            </p>
          )}
        </div>
      )}

      <div className="set-group">
        {confirmReset ? (
          <div className="confirm">
            <span>恢复默认的货币列表和设置？</span>
            <button type="button" className="btn-danger" onClick={() => { reset(); setConfirmReset(false); }}>
              恢复
            </button>
            <button type="button" className="btn" onClick={() => setConfirmReset(false)}>
              取消
            </button>
          </div>
        ) : (
          <button type="button" className="btn-text" onClick={() => setConfirmReset(true)}>
            恢复默认设置
          </button>
        )}
        <p className="credits">国旗图标 circle-flags（MIT）· 字体 Manrope（OFL）· 图标 Lucide（ISC）</p>
      </div>
    </Sheet>
  );
}
