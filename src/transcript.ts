export function extractFinalMessage(raw: string): string | null {
  let lastContent: unknown[] | null = null;

  for (const line of raw.split('\n')) {
    if (line.trim() === '') {
      continue;
    }

    let entry: unknown;

    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(entry) || entry.type !== 'assistant' || !isRecord(entry.message)) {
      continue;
    }

    const content = entry.message.content;

    if (!Array.isArray(content) || !content.some(isNonEmptyTextBlock)) {
      continue;
    }

    lastContent = content;
  }

  if (lastContent === null) {
    return null;
  }

  return lastContent
    .filter(isTextBlock)
    .map((block) => block.text)
    .join('');
}

function isNonEmptyTextBlock(value: unknown): value is { type: 'text'; text: string } {
  return isTextBlock(value) && value.text.trim() !== '';
}

function isTextBlock(value: unknown): value is { type: 'text'; text: string } {
  return isRecord(value) && value.type === 'text' && typeof value.text === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
