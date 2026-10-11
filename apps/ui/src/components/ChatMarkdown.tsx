import { For, Match, Switch, createMemo, type JSX } from "solid-js";

/**
 * The small markdown subset assistant replies use: paragraphs, bold, italics, inline code, lists
 * and code fences. Headings become bold lines and table rows plain lines, because a chat column
 * has no room for either. Everything renders as text nodes; nothing is ever parsed as HTML.
 */

export type ChatInline =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "strong"; readonly text: string }
  | { readonly kind: "em"; readonly text: string }
  | { readonly kind: "code"; readonly text: string };

export type ChatBlock =
  | { readonly kind: "paragraph"; readonly lines: readonly (readonly ChatInline[])[] }
  | { readonly kind: "heading"; readonly inline: readonly ChatInline[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly ChatInline[])[];
    }
  | { readonly kind: "code"; readonly text: string };

// `_` is left alone on purpose: identifiers such as snake_case names must not turn italic.
const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\*[^*\s][^*\n]*\*)/u;

export function parseChatInline(text: string): ChatInline[] {
  return text
    .split(INLINE)
    .filter((part) => part.length > 0)
    .map((part): ChatInline => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return { kind: "strong", text: part.slice(2, -2) };
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2)
        return { kind: "code", text: part.slice(1, -1) };
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2)
        return { kind: "em", text: part.slice(1, -1) };
      return { kind: "text", text: part };
    });
}

const BULLET = /^\s*[-*+]\s+(.*)$/u;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/u;
const HEADING = /^\s*#{1,6}\s+(.*)$/u;
const TABLE_ROW = /^\s*\|(.*)\|\s*$/u;
const TABLE_RULE = /^\s*\|?[\s:|-]+\|?\s*$/u;

interface OpenBlocks {
  paragraph: ChatInline[][];
  list: { readonly ordered: boolean; readonly items: ChatInline[][] } | null;
}

export function parseChatMarkdown(text: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  const open: OpenBlocks = { paragraph: [], list: null };
  const flush = () => {
    if (open.paragraph.length) blocks.push({ kind: "paragraph", lines: open.paragraph });
    if (open.list)
      blocks.push({ kind: "list", ordered: open.list.ordered, items: open.list.items });
    open.paragraph = [];
    open.list = null;
  };
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (line.trim().startsWith("```")) {
      flush();
      const code: string[] = [];
      for (index++; index < lines.length && !(lines[index] ?? "").trim().startsWith("```"); index++)
        code.push(lines[index] ?? "");
      blocks.push({ kind: "code", text: code.join("\n") });
      continue;
    }
    if (!line.trim()) {
      flush();
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      flush();
      blocks.push({ kind: "heading", inline: parseChatInline(heading[1] ?? "") });
      continue;
    }
    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = numbered !== null;
      if (open.paragraph.length || (open.list && open.list.ordered !== ordered)) flush();
      open.list ??= { ordered, items: [] };
      open.list.items.push(parseChatInline(item[1] ?? ""));
      continue;
    }
    const row = TABLE_ROW.exec(line);
    if (row && TABLE_RULE.test(line)) continue;
    if (open.list) flush();
    open.paragraph.push(
      parseChatInline(
        row
          ? (row[1] ?? "")
              .split("|")
              .map((cell) => cell.trim())
              .join(" · ")
          : line,
      ),
    );
  }
  flush();
  return blocks;
}

/** The reply as one line of plain text, for places that show only a glimpse of it. */
export function chatPlainText(text: string): string {
  const words = (parts: readonly ChatInline[]) => parts.map((part) => part.text).join("");
  return parseChatMarkdown(text)
    .map((block) =>
      block.kind === "paragraph"
        ? block.lines.map(words).join(" ")
        : block.kind === "heading"
          ? words(block.inline)
          : block.kind === "list"
            ? block.items.map(words).join("; ")
            : block.text,
    )
    .join(" ");
}

function Inline(props: { readonly parts: readonly ChatInline[] }): JSX.Element {
  return (
    <For each={props.parts}>
      {(part) => (
        <Switch fallback={part.text}>
          <Match when={part.kind === "strong"}>
            <strong>{part.text}</strong>
          </Match>
          <Match when={part.kind === "em"}>
            <em>{part.text}</em>
          </Match>
          <Match when={part.kind === "code"}>
            <code>{part.text}</code>
          </Match>
        </Switch>
      )}
    </For>
  );
}

export default function ChatMarkdown(props: { readonly text: string }) {
  const blocks = createMemo(() => parseChatMarkdown(props.text));
  return (
    <For each={blocks()}>
      {(block) => (
        <Switch>
          <Match when={block.kind === "paragraph" && block}>
            {(paragraph) => (
              <p>
                <For each={paragraph().lines}>
                  {(line, index) => (
                    <>
                      {index() > 0 ? "\n" : ""}
                      <Inline parts={line} />
                    </>
                  )}
                </For>
              </p>
            )}
          </Match>
          <Match when={block.kind === "heading" && block}>
            {(heading) => (
              <p>
                <strong>
                  <Inline parts={heading().inline} />
                </strong>
              </p>
            )}
          </Match>
          <Match when={block.kind === "list" && block}>
            {(list) => {
              const items = (
                <For each={list().items}>
                  {(item) => (
                    <li>
                      <Inline parts={item} />
                    </li>
                  )}
                </For>
              );
              return list().ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
            }}
          </Match>
          <Match when={block.kind === "code" && block}>
            {(code) => (
              <pre>
                <code>{code().text}</code>
              </pre>
            )}
          </Match>
        </Switch>
      )}
    </For>
  );
}
