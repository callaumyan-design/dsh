import { lazy, Suspense } from 'react';
import { cn } from '@/lib/utils';

// The Markdown stack (remark/rehype, KaTeX, highlight.js) is the heaviest part of the app;
// load it on demand so sign-in and the welcome screen appear faster.
const load = () => import('./Markdown');
const Impl = lazy(() => load().then((m) => ({ default: m.Markdown })));

export const preloadMarkdown = () => void load();

export function Markdown(props: { content: string; streaming?: boolean; className?: string }) {
  return (
    <Suspense fallback={<div className={cn('md whitespace-pre-wrap', props.className)}>{props.content}</div>}>
      <Impl {...props} />
    </Suspense>
  );
}
