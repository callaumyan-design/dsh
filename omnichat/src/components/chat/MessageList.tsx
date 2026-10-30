import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';
import type { Message } from '@/lib/types';
import { cn } from '@/lib/utils';
import { MessageItem } from './MessageItem';

export function MessageList({ messages, streamingId, conversationId }: { messages: Message[]; streamingId?: string; conversationId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const toBottom = useCallback((smooth = false) => {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }, []);

  // Jump to the end when switching conversations.
  useLayoutEffect(() => {
    stick.current = true;
    toBottom();
  }, [conversationId, toBottom]);

  // Follow new content only while the user is at the bottom.
  useLayoutEffect(() => {
    if (stick.current) toBottom();
  }, [messages, toBottom]);

  // Content can grow after render (images, KaTeX, diagrams).
  useEffect(() => {
    const inner = ref.current?.firstElementChild;
    if (!inner) return;
    const ro = new ResizeObserver(() => {
      if (stick.current) toBottom();
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, [toBottom]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    stick.current = dist < 80;
    setShowJump(dist > 400);
  };

  return (
    <div className="relative min-h-0 flex-1">
      <div ref={ref} onScroll={onScroll} className="h-full overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-3xl space-y-6 px-4 pt-4 pb-8 sm:px-6">
          {messages.map((m, i) => (
            // Off-screen older messages skip layout/paint, keeping long chats fast.
            <div key={m.id} style={i < messages.length - 6 ? { contentVisibility: 'auto', containIntrinsicSize: 'auto 240px' } : undefined}>
              <MessageItem m={m} streaming={m.id === streamingId} isLast={i === messages.length - 1} />
            </div>
          ))}
        </div>
      </div>
      <button
        type="button"
        aria-label="Scroll to bottom"
        onClick={() => {
          stick.current = true;
          toBottom(true);
        }}
        className={cn(
          'absolute bottom-3 left-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-line bg-elevated text-fg-muted shadow-pop transition-all hover:text-fg',
          showJump ? 'opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
        )}
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  );
}
