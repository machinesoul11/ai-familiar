export const MAX_GIST_CHARS = 400;

export function condenseFinalMessage(raw: string | null): string | null {
  if (raw === null || raw.trim() === '') {
    return null;
  }

  const normalized = raw.replace(/\r\n/g, '\n');
  const blankLineIndex = normalized.indexOf('\n\n');
  const leadBlock = blankLineIndex === -1
    ? normalized
    : normalized.slice(0, blankLineIndex);
  const flattened = leadBlock
    .replace(/\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:#{1,6}|[-*+>]|\d+\.)(?:\s+|$)/, '');

  if (flattened === '') {
    return null;
  }

  if (flattened.length <= MAX_GIST_CHARS) {
    return flattened;
  }

  const window = flattened.slice(0, MAX_GIST_CHARS);
  const lastSentenceTerminator = Math.max(
    window.lastIndexOf('.'),
    window.lastIndexOf('!'),
    window.lastIndexOf('?'),
  );

  if (lastSentenceTerminator !== -1) {
    return window.slice(0, lastSentenceTerminator + 1);
  }

  const lastSpace = window.lastIndexOf(' ');
  const cut = lastSpace === -1 ? MAX_GIST_CHARS - 1 : lastSpace;

  return `${window.slice(0, cut)}…`;
}
