export type RecognizedIntent = 'pull-recap' | 'recall' | null;

const RECALL_PHRASES = [
  'while i was away',
  'while i was gone',
  'what did i miss',
  'what i missed',
  'catch me up',
  'recall',
];
const RECAP_PHRASES = ['recap', 'status', 'what happened', 'where are we', 'summary', 'summarize'];

export function classifyUtterance(text: string): RecognizedIntent {
  const t = text.toLowerCase().trim();

  if (t === '') {
    return null;
  }

  if (RECALL_PHRASES.some((phrase) => t.includes(phrase))) {
    return 'recall';
  }

  if (RECAP_PHRASES.some((phrase) => t.includes(phrase))) {
    return 'pull-recap';
  }

  return null;
}
