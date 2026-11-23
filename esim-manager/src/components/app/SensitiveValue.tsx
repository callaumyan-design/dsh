import { useEffect, useState } from 'react';
import { Copy, CopyCheck, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { maskId } from '@/lib/protocol/redact';
import { cn } from '@/lib/utils';

/**
 * 默认脱敏显示的敏感值（EID / ICCID）。明文只在组件内存里，30 秒后自动重新隐藏，
 * 复制需要先显示。
 */
export function SensitiveValue({ value, label, className, mono = true }: { value: string | null | undefined; label: string; className?: string; mono?: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const t = setTimeout(() => setRevealed(false), 30_000);
    return () => clearTimeout(t);
  }, [revealed]);

  if (!value) return <span className="text-muted-foreground">—</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用 */
    }
  };

  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1', className)}>
      <span className={cn('truncate', mono && 'font-mono tabular text-[0.92em] tracking-tight')} aria-label={revealed ? `${label}：${value}` : `${label}（已隐藏）`}>
        {revealed ? value : maskId(value)}
      </span>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" onClick={() => setRevealed((v) => !v)} aria-label={revealed ? `隐藏${label}` : `显示${label}`}>
            {revealed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{revealed ? '隐藏' : '显示完整内容（30 秒后自动隐藏）'}</TooltipContent>
      </Tooltip>
      {revealed && (
        <Button variant="ghost" size="icon-sm" className="size-7 shrink-0" onClick={copy} aria-label={`复制${label}`}>
          {copied ? <CopyCheck className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
        </Button>
      )}
    </span>
  );
}
