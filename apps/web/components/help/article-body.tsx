import Link from 'next/link';
import type { ReactNode } from 'react';

/** **bold**, `code` and [text](/path) inside a line. Only links within the site are made. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[(.+?)\]\((\/[^)\s]*)\)|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[4])
      out.push(
        <code key={m.index} className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[13px] text-gray-800">
          {m[4]}
        </code>,
      );
    else
      out.push(
        <Link key={m.index} href={m[3]!} className="text-brand-700 underline">
          {m[2]}
        </Link>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Renders a help article's body (see lib/help.ts for the format) without any raw HTML. */
export function ArticleBody({ body }: { body: string }) {
  const blocks = body.trim().split(/\n{2,}/);
  return (
    <div className="space-y-4 text-[15px] leading-7 text-gray-700">
      {blocks.map((block, i) => {
        const lines = block.split('\n');
        // A code example: ``` on its own line before and after (no blank lines inside).
        if (lines.length > 1 && lines[0]!.startsWith('```') && lines.at(-1) === '```') {
          return (
            <pre key={i} className="overflow-x-auto rounded-xl bg-gray-900 p-4 font-mono text-[13px] leading-6 text-gray-100">
              <code>{lines.slice(1, -1).join('\n')}</code>
            </pre>
          );
        }
        if (block.startsWith('## ')) {
          return (
            <h2 key={i} className="pt-4 text-xl font-semibold text-gray-900">
              {block.slice(3)}
            </h2>
          );
        }
        if (block.startsWith('> ')) {
          return (
            <p key={i} className="rounded-xl border border-brand-100 bg-brand-50 px-4 py-3 text-sm text-brand-800">
              {inline(lines.map((l) => l.replace(/^> ?/, '')).join(' '))}
            </p>
          );
        }
        if (lines.every((l) => l.startsWith('- '))) {
          return (
            <ul key={i} className="list-disc space-y-1.5 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.slice(2))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\d+\. /.test(l))) {
          return (
            <ol key={i} className="list-decimal space-y-1.5 pl-6">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\d+\. /, ''))}</li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{inline(lines.join(' '))}</p>;
      })}
    </div>
  );
}
