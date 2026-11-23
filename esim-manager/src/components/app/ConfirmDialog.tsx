import { useState, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  /** 需要用户输入这段文字才能确认（用于删除等不可恢复的操作）。 */
  requireText?: string;
  requireTextLabel?: string;
  onConfirm: () => Promise<unknown> | void;
}

/** 二次确认对话框。确认期间禁止关闭，避免用户以为已取消。 */
export function ConfirmDialog({ open, onOpenChange, title, description, children, confirmLabel, destructive, requireText, requireTextLabel, onConfirm }: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const canConfirm = !busy && (!requireText || typed.trim() === requireText);

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) setTyped('');
    onOpenChange(next);
  };

  const confirm = async () => {
    if (!canConfirm) return;
    setBusy(true);
    try {
      await onConfirm();
      setTyped('');
      onOpenChange(false);
    } catch {
      /* 调用方已提示错误；保持对话框关闭以便查看页面状态 */
      setTyped('');
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription asChild><div className="space-y-2">{description}</div></AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        {requireText && (
          <div className="grid gap-2">
            <Label htmlFor="confirm-text">{requireTextLabel ?? `请输入 “${requireText}” 以确认`}</Label>
            <Input id="confirm-text" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder={requireText} disabled={busy} />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
          <Button variant={destructive ? 'destructive' : 'default'} disabled={!canConfirm} onClick={confirm}>
            {busy && <LoaderCircle className="animate-spin" />}
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
