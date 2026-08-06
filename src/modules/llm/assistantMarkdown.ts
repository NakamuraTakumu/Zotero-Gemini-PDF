/**
 * Remove Markdown blockquote markers from assistant output while preserving
 * fenced code blocks verbatim.
 */
export function normalizeAssistantMarkdown(text: string): string {
  const parts = text.split(/(\r\n|\n|\r)/);
  let fence: { character: "`" | "~"; length: number } | undefined;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    if (fence) {
      const closing = new RegExp(
        `^[ \\t]{0,3}\\${fence.character}{${fence.length},}[ \\t]*$`,
      );
      if (closing.test(line)) fence = undefined;
      continue;
    }

    const opening = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(?:[^`~]*)?$/);
    if (opening) {
      fence = {
        character: opening[1][0] as "`" | "~",
        length: opening[1].length,
      };
      continue;
    }

    parts[index] = line.replace(/^[ \t]*(?:(?:>[ \t]?)+)/, "");
  }

  return parts.join("");
}
