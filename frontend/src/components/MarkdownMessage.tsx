import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type { Components } from 'react-markdown';
import 'katex/dist/katex.min.css';

const markdownComponents: Components = {
  img: ({ alt, ...props }) => (
    <img {...props} alt={alt ?? ''} className="my-2 max-h-96 max-w-full rounded-md border border-border" />
  ),
};

const markdownClassName =
  'select-text text-sm leading-relaxed text-card-foreground [&_*]:break-words ' +
  '[&_.katex-display]:my-3 [&_.katex-display]:overflow-x-auto ' +
  '[&_p]:mb-3 [&_p:last-child]:mb-0 ' +
  '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:tracking-tight ' +
  '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h2]:tracking-tight ' +
  '[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold ' +
  '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 ' +
  '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 ' +
  '[&_li]:my-0.5 [&_li]:marker:text-muted-foreground ' +
  '[&_blockquote]:my-3 [&_blockquote]:border-l-4 [&_blockquote]:border-muted-foreground/35 [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground ' +
  '[&_hr]:my-4 [&_hr]:border-border ' +
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 ' +
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm ' +
  '[&_th]:border [&_th]:border-border [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left [&_th]:font-medium ' +
  '[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5 ' +
  '[&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/40 [&_pre]:p-3 ' +
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[13px] [&_pre_code]:leading-relaxed ' +
  '[&_code]:rounded [&_code]:bg-muted/70 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[0.85em] [&_pre_code]:rounded-none [&_pre_code]:bg-transparent';

type MarkdownMessageProps = {
  children: string;
  className?: string;
};

export function MarkdownMessage({ children, className }: MarkdownMessageProps) {
  return (
    <div className={[markdownClassName, className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
