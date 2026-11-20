import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';
import { useUI } from '@/store/ui';
import { useT } from '@/i18n';
import { cn } from '@/lib/utils';
import { Button, Input, Modal } from './primitives';

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  if (!toasts.length) return null;
  return createPortal(
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[80] flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'anim-pop pointer-events-auto flex max-w-md items-start gap-2 rounded-xl border border-line bg-elevated px-3.5 py-2.5 text-sm text-fg shadow-pop',
          )}
        >
          {t.kind === 'error' ? (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-danger" />
          ) : t.kind === 'success' ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-accent" />
          )}
          <span className="break-words">{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function Dialogs() {
  const t = useT();
  const confirm = useUI((s) => s.confirm);
  const prompt = useUI((s) => s.prompt);
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prompt) {
      setValue(prompt.value);
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 30);
    }
  }, [prompt]);

  const closeConfirm = (ok: boolean) => {
    confirm?.resolve(ok);
    useUI.setState({ confirm: null });
  };
  const closePrompt = (v: string | null) => {
    prompt?.resolve(v);
    useUI.setState({ prompt: null });
  };

  return (
    <>
      <Modal
        open={!!confirm}
        onClose={() => closeConfirm(false)}
        size="sm"
        title={confirm?.title}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => closeConfirm(false)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant={confirm?.danger ? 'danger' : 'primary'} onClick={() => closeConfirm(true)} autoFocus>
              {confirm?.confirmText ?? t('common.confirm')}
            </Button>
          </>
        }
      >
        {confirm?.message && <p className="text-sm leading-relaxed text-fg-muted">{confirm.message}</p>}
      </Modal>
      <Modal
        open={!!prompt}
        onClose={() => closePrompt(null)}
        size="sm"
        title={prompt?.title}
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => closePrompt(null)}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" variant="primary" onClick={() => closePrompt(value)}>
              {t('common.save')}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            closePrompt(value);
          }}
        >
          <Input ref={inputRef} value={value} placeholder={prompt?.placeholder} onChange={(e) => setValue(e.target.value)} />
        </form>
      </Modal>
    </>
  );
}
