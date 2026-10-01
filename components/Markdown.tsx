import type { ReactNode } from "react";

function renderInline(text: string, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re =
    /(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|(\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))|(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    const k = `${prefix}-${i++}`;
    if (m[1]) {
      nodes.push(
        <code key={k} className="rounded bg-bg px-1 py-0.5 text-[12.5px] text-gold">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (m[2]) {
      nodes.push(
        <strong key={k} className="font-semibold">
          {tok.slice(2, -2)}
        </strong>
      );
    } else if (m[3]) {
      const mm = /^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(tok);
      if (mm) {
        nodes.push(
          <a key={k} href={mm[2]} target="_blank" rel="noreferrer" className="text-gold underline">
            {mm[1]}
          </a>
        );
      } else {
        nodes.push(tok);
      }
    } else {
      nodes.push(
        <a key={k} href={tok} target="_blank" rel="noreferrer" className="break-all text-gold underline">
          {tok}
        </a>
      );
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

const isBullet = (l: string) => /^\s*[-*•]\s+/.test(l);
const isNumbered = (l: string) => /^\s*\d+[.)]\s+/.test(l);
const isHeading = (l: string) => /^#{1,4}\s+/.test(l);
const isFence = (l: string) => l.trim().startsWith("```");

export default function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (isFence(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !isFence(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(
        <pre
          key={key++}
          className="my-2 overflow-x-auto rounded-lg border border-line bg-bg p-3 text-[12.5px] leading-relaxed text-ink"
        >
          <code>{code.join("\n")}</code>
        </pre>
      );
    } else if (isHeading(line)) {
      const content = line.replace(/^#{1,4}\s+/, "");
      out.push(
        <p key={key++} className="mb-1 mt-3 text-[15px] font-semibold text-ink">
          {renderInline(content, `h${key}`)}
        </p>
      );
      i++;
    } else if (isBullet(line)) {
      const items: string[] = [];
      while (i < lines.length && isBullet(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*•]\s+/, ""));
        i++;
      }
      out.push(
        <ul key={key++} className="my-1.5 list-disc space-y-1 pl-5">
          {items.map((it, n) => (
            <li key={n}>{renderInline(it, `u${key}-${n}`)}</li>
          ))}
        </ul>
      );
    } else if (isNumbered(line)) {
      const items: string[] = [];
      while (i < lines.length && isNumbered(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""));
        i++;
      }
      out.push(
        <ol key={key++} className="my-1.5 list-decimal space-y-1 pl-5">
          {items.map((it, n) => (
            <li key={n}>{renderInline(it, `o${key}-${n}`)}</li>
          ))}
        </ol>
      );
    } else if (line.trim() === "") {
      i++;
    } else {
      const para: string[] = [];
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !isFence(lines[i]) &&
        !isHeading(lines[i]) &&
        !isBullet(lines[i]) &&
        !isNumbered(lines[i])
      ) {
        para.push(lines[i]);
        i++;
      }
      out.push(
        <p key={key++} className="my-1.5">
          {para.map((p, n) => (
            <span key={n}>
              {n > 0 && <br />}
              {renderInline(p, `p${key}-${n}`)}
            </span>
          ))}
        </p>
      );
    }
  }

  return <div className="break-words">{out}</div>;
}