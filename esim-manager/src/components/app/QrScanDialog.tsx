import { useEffect, useRef, useState } from 'react';
import { Camera, CameraOff, LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { decodeQrFromVideo, extractActivationCode, QrError } from '@/lib/qr/qr';

type Status = { kind: 'starting' } | { kind: 'scanning'; hint: string | null } | { kind: 'error'; message: string };

function cameraError(error: unknown): string {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return '没有获得摄像头权限。请在地址栏左侧的站点设置中允许使用摄像头，或改用图片识别。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '没有找到可用的摄像头。可以把二维码截图后拖进来或粘贴。';
    case 'NotReadableError':
      return '摄像头正被其他程序占用。';
    default:
      return `无法打开摄像头：${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * 摄像头扫描激活码二维码。画面只在本地逐帧识别，不录制、不上传；
 * 对话框关闭或识别成功后立即释放摄像头。
 */
export function QrScanDialog({ open, onOpenChange, onResult }: { open: boolean; onOpenChange: (open: boolean) => void; onResult: (activationCode: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState<Status>({ kind: 'starting' });

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    const canvas = document.createElement('canvas');
    setStatus({ kind: 'starting' });

    const stop = () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    };

    const tick = async () => {
      if (stopped) return;
      const video = videoRef.current;
      try {
        const text = video ? await decodeQrFromVideo(video, canvas) : null;
        if (text && !stopped) {
          try {
            const code = extractActivationCode(text);
            stop();
            onResult(code);
            onOpenChange(false);
            return;
          } catch (error) {
            setStatus({ kind: 'scanning', hint: error instanceof QrError ? error.message : String(error) });
          }
        }
      } catch {
        /* 单帧失败忽略 */
      }
      if (!stopped) timer = setTimeout(tick, 200);
    };

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus({ kind: 'error', message: '此浏览器不支持摄像头访问。可以把二维码截图后拖进来或粘贴。' });
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          // 不等待 play()：某些环境下它迟迟不 resolve；逐帧识别会等画面就绪
          void video.play().catch(() => undefined);
        }
        setStatus({ kind: 'scanning', hint: null });
        void tick();
      } catch (error) {
        setStatus({ kind: 'error', message: cameraError(error) });
      }
    })();

    return () => {
      stop();
      if (videoRef.current) videoRef.current.srcObject = null;
    };
  }, [open, onOpenChange, onResult]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Camera className="size-4" /> 扫描激活码二维码
          </DialogTitle>
          <DialogDescription>把二维码放进取景框内。画面只在本机识别，不会录制或上传。</DialogDescription>
        </DialogHeader>
        <div className="relative aspect-square overflow-hidden rounded-lg bg-black">
          <video ref={videoRef} className="size-full object-cover" playsInline muted aria-label="摄像头画面" />
          {status.kind === 'scanning' && (
            <div className="pointer-events-none absolute inset-[15%] rounded-xl border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
          )}
          {status.kind === 'starting' && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-white">
              <LoaderCircle className="size-4 animate-spin" /> 正在打开摄像头…
            </div>
          )}
          {status.kind === 'error' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-white">
              <CameraOff className="size-8 opacity-80" />
              {status.message}
            </div>
          )}
        </div>
        {status.kind === 'scanning' && <p className="text-center text-sm text-muted-foreground">{status.hint ?? '正在识别…'}</p>}
      </DialogContent>
    </Dialog>
  );
}
