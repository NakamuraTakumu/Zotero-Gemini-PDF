export function stripThoughtsFromText(
  text: string,
  thoughts?: string[],
): string {
  if (!thoughts || thoughts.length === 0) return text;

  let result = text;
  for (const thought of thoughts) {
    const normalizedThought = thought.trim();
    if (!normalizedThought) continue;

    const index = result.indexOf(normalizedThought);
    if (index === -1) continue;

    result =
      result.slice(0, index) + result.slice(index + normalizedThought.length);
  }

  return result.trimStart();
}
