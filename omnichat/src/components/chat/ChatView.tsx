import { useEffect, useState } from 'react';
import { Upload } from 'lucide-react';
import { addFiles } from '@/store/composer';
import { useChat } from '@/store/chat';
import { loadMessages, useData } from '@/store/data';
import { openConversation, useUI } from '@/store/ui';
import { useT } from '@/i18n';
import { ChatHeader } from './ChatHeader';
import { ChatSettingsPanel } from './ChatSettingsPanel';
import { Composer } from './Composer';
import { MessageList } from './MessageList';
import { Welcome } from './Welcome';

const EMPTY: never[] = [];

export function ChatView() {
  const t = useT();
  const activeId = useUI((s) => s.activeId);
  const hydrated = useData((s) => s.hydrated);
  const conv = useData((s) => (activeId ? s.conversations[activeId] : undefined));
  const messages = useData((s) => (activeId ? (s.messages[activeId] ?? EMPTY) : EMPTY));
  const loaded = useData((s) => (activeId ? !!s.messagesLoaded[activeId] : true));
  const streamingId = useChat((s) => (activeId ? s.streaming[activeId]?.messageId : undefined));
  const chatSettingsOpen = useUI((s) => s.chatSettingsOpen);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (activeId) void loadMessages(activeId);
  }, [activeId]);

  // A conversation link that no longer exists (deleted elsewhere) falls back to a new chat.
  useEffect(() => {
    if (activeId && hydrated && !conv) {
      const timer = setTimeout(() => {
        if (!useData.getState().conversations[activeId]) openConversation(null);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [activeId, hydrated, conv]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files);
  };

  return (
    <div className="flex min-w-0 flex-1">
      <main
        className="relative flex min-w-0 flex-1 flex-col"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
        }}
        onDrop={onDrop}
      >
        <ChatHeader conversationId={conv ? conv.id : null} />
        {conv ? (
          <>
            {messages.length === 0 && loaded ? (
              <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-fg-subtle">{t('chat.empty')}</div>
            ) : (
              <MessageList messages={messages} streamingId={streamingId} conversationId={conv.id} />
            )}
            <Composer />
          </>
        ) : (
          <Welcome />
        )}
        {dragging && (
          <div className="pointer-events-none absolute inset-2 z-20 flex items-center justify-center rounded-3xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm">
            <div className="flex flex-col items-center gap-2 text-accent">
              <Upload className="size-8" />
              <span className="text-sm font-medium">{t('composer.dropHere')}</span>
            </div>
          </div>
        )}
      </main>
      {conv && chatSettingsOpen && <ChatSettingsPanel conversationId={conv.id} />}
    </div>
  );
}
