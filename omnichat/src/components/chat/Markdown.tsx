import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import rehypeHighlight from 'rehype-highlight';
import { Check, Code2, Copy, Eye, WrapText } from 'lucide-react';
import { cn, copyText } from '@/lib/utils';
import { useData } from '@/store/data';
import { useT } from '@/i18n';
import { Modal } from '@/components/ui/primitives';

type HastNode = { type: string; value?: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] };

function hastText(node: HastNode | undefined): string {
  if (!node) return '';
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/** Converts \( \) and \[ \] math delimiters (common in model output) to $ / $$, outside code. */
export function normalizeMath(src: string): string {
  if (!src.includes('\\(') && !src.includes('\\[') && !src.includes('$$')) return src;
  const parts = src.split(/(```[\s\S]*?(?:```|$)|`[^`\n]*`)/g);
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part;
      return part
        .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `\n$$\n${m.trim()}\n$$\n`)
        .replace(/\\\((.+?)\\\)/g, (_, m) => `$${m.trim()}$`)
        .replace(/^[ \t]*\$\$([^\n]+?)\$\$[ \t]*$/gm, (_, m) => `$$\n${m.trim()}\n$$`);
    })
    .join('');
}

function CopyButton({ text, className, label }: { text: string; className?: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={cn('inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors', className)}
      onClick={async () => {
        if (await copyText(text)) {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }
      }}
    >
      {done ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {label && <span>{label}</span>}
    </button>
  );
}

let mermaidSeq = 0;

function Mermaid({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dark = document.documentElement.classList.contains('dark');
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({ startOnLoad: false, theme: dark ? 'dark' : 'default', securityLevel: 'strict' });
        const { svg } = await mermaid.render(`mmd-${++mermaidSeq}`, code);
        if (!cancelled) setSvg(svg);
      } catch (err) {
        if (!cancelled) setError((err as Error).message ?? String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code, dark]);
  if (error) return <div className="p-3 text-xs text-danger">{error}</div>;
  if (!svg) return <div className="p-4 text-xs text-fg-subtle">…</div>;
  return <div className="flex justify-center overflow-x-auto bg-white p-4 dark:bg-[#0e0f13] [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function CodeBlock({ lang, code, children, streaming }: { lang: string; code: string; children: ReactNode; streaming?: boolean }) {
  const t = useT();
  const defaultWrap = useData((s) => s.settings.codeWrap);
  const [wrap, setWrap] = useState(defaultWrap);
  const [preview, setPreview] = useState(false);
  const isMermaid = lang === 'mermaid';
  const [showDiagram, setShowDiagram] = useState(true);
  const canPreview = ['html', 'svg', 'xml'].includes(lang) && /<(html|body|div|svg|!doctype|script|style|canvas)/i.test(code);
  const lines = code.split('\n').length;

  return (
    <div className={cn('code-block overflow-hidden rounded-xl border border-black/10 dark:border-white/10', wrap && 'code-wrap')}>
      <div className="flex items-center justify-between gap-2 bg-[var(--code-head)] px-3 py-1.5 text-[#9ca3af]">
        <span className="font-mono text-xs">{lang || 'text'}</span>
        <div className="flex items-center gap-0.5">
          {isMermaid && !streaming && (
            <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-white/10 hover:text-white" onClick={() => setShowDiagram((v) => !v)}>
              {showDiagram ? <Code2 className="size-3.5" /> : <Eye className="size-3.5" />}
              <span>{showDiagram ? t('code.source') : t('code.diagram')}</span>
            </button>
          )}
          {canPreview && (
            <button type="button" className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs hover:bg-white/10 hover:text-white" onClick={() => setPreview(true)}>
              <Eye className="size-3.5" />
              <span>{t('code.preview')}</span>
            </button>
          )}
          {lines > 1 && (
            <button
              type="button"
              title={t('code.wrap')}
              className={cn('rounded-md px-1.5 py-1 hover:bg-white/10 hover:text-white', wrap && 'text-white')}
              onClick={() => setWrap((v) => !v)}
            >
              <WrapText className="size-3.5" />
            </button>
          )}
          <CopyButton text={code} label={t('common.copy')} className="hover:bg-white/10 hover:text-white" />
        </div>
      </div>
      {isMermaid && showDiagram && !streaming ? <Mermaid code={code} /> : children}
      {canPreview && (
        <Modal open={preview} onClose={() => setPreview(false)} title={t('code.preview')} size="xl" mobileFull bodyClassName="p-0">
          <iframe title="preview" sandbox="allow-scripts allow-modals allow-forms" srcDoc={code} className="h-[75dvh] w-full bg-white" />
        </Modal>
      )}
    </div>
  );
}

const remarkPlugins = [remarkGfm, [remarkMath, { singleDollarTextMath: true }]] as never;
const rehypePlugins = [
  [rehypeKatex, { throwOnError: false, strict: false, output: 'html' }],
  [rehypeHighlight, { detect: false, ignoreMissing: true }],
] as never;

function MarkdownImpl({ content, streaming, className }: { content: string; streaming?: boolean; className?: string }) {
  const streamingRef = useRef(streaming);
  streamingRef.current = streaming;
  const components = useMemo<Components>(
    () => ({
      pre({ node, children }) {
        const codeEl = (node as unknown as HastNode)?.children?.find((c) => c.tagName === 'code');
        const cls = (codeEl?.properties?.className as string[] | undefined) ?? [];
        const lang = (cls.find((c) => c.startsWith('language-')) ?? '').replace('language-', '');
        const code = hastText(codeEl).replace(/\n$/, '');
        return (
          <CodeBlock lang={lang} code={code} streaming={streamingRef.current}>
            <pre>{children}</pre>
          </CodeBlock>
        );
      },
      a({ href, children }) {
        return (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
      table({ children }) {
        return <table>{children}</table>;
      },
    }),
    [],
  );
  const src = useMemo(() => normalizeMath(content), [content]);
  return (
    <div className={cn('md', className)}>
      <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={rehypePlugins} components={components}>
        {src}
      </ReactMarkdown>
    </div>
  );
}

export const Markdown = memo(MarkdownImpl);
export { CopyButton };
