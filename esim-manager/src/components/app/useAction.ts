import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { errorMessage } from '@/lib/utils';

/** 包装一个异步操作：处理 loading、成功/失败提示。错误信息已在协议层脱敏。 */
export function useAction() {
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(async <T,>(key: string, task: () => Promise<T>, messages: { success?: string | ((r: T) => string); silentSuccess?: boolean } = {}): Promise<T | undefined> => {
    setPending(key);
    try {
      const result = await task();
      if (!messages.silentSuccess) {
        const msg = typeof messages.success === 'function' ? messages.success(result) : messages.success;
        if (msg) toast.success(msg);
      }
      return result;
    } catch (error) {
      toast.error(errorMessage(error), { duration: 8000 });
      return undefined;
    } finally {
      setPending(null);
    }
  }, []);
  return { pending, run };
}
