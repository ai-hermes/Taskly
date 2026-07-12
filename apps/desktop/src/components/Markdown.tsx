import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";

/** A line that is purely a thematic break: 3+ of `-`, `*` or `_` (CommonMark). */
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
/** Opening/closing fence of a code block (``` or ~~~). */
const CODE_FENCE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Clean up agent narration before rendering:
 *  1. Strip standalone horizontal-rule lines (`---`, `***`, `___`). In a chat
 *     context these separators are pure visual noise — the model emits them
 *     liberally (e.g. between PPT sections) and each renders as an `<hr>`,
 *     stacking into a wall of divider lines. Removing them also prevents a
 *     `text` + `---` pair from being parsed as an oversized setext `<h2>`.
 *  2. Collapse runs of 3+ blank lines down to a single blank line, so a model
 *     that pads its output with many newlines doesn't leave huge empty gaps.
 * Both passes are fence-aware so real `---`/whitespace inside code/diff/YAML
 * blocks is preserved verbatim.
 */
function cleanMarkdown(text: string): string {
  let inFence = false;
  const out: string[] = [];
  let blankRun = 0;
  for (const line of text.split("\n")) {
    if (CODE_FENCE.test(line)) {
      inFence = !inFence;
      blankRun = 0;
      out.push(line);
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (THEMATIC_BREAK.test(line)) continue;
    if (line.trim() === "") {
      blankRun += 1;
      if (blankRun > 1) continue; // keep at most one blank line
      out.push(line);
      continue;
    }
    blankRun = 0;
    out.push(line);
  }
  // Drop leading/trailing blank lines left behind by the passes above.
  return out.join("\n").replace(/^\n+/, "").replace(/\n+$/, "");
}

/**
 * Render agent output as GitHub-flavored Markdown with syntax-highlighted code
 * blocks. Links are forced to open in a new context and never navigate the app
 * shell; code/tables/lists get styled via the `.md` scope in global.css.
 * Memoized so streaming updates only re-parse when the text actually changes.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const cleaned = useMemo(() => cleanMarkdown(text), [text]);
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          a: ({ node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener" />
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
});
