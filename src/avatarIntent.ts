export type AvatarIntent =
  | { kind: 'avatar-intent'; intent: 'pull-recap' }
  | { kind: 'avatar-intent'; intent: 'recall' }
  | { kind: 'avatar-intent'; intent: 'utterance'; text: string }
  | { kind: 'avatar-intent'; intent: 'stop' }
  | { kind: 'avatar-intent'; intent: 'tap' };

export interface AvatarIntentActions {
  pullRecap: () => void;
  recall: () => void;
  utterance: (text: string) => void;
  stop: () => void;
  tap: () => void;
}

export function parseIntent(raw: string): AvatarIntent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isPlainObject(parsed) || parsed.kind !== 'avatar-intent') {
    return null;
  }

  if (parsed.intent === 'pull-recap') {
    return { kind: 'avatar-intent', intent: 'pull-recap' };
  }

  if (parsed.intent === 'recall') {
    return { kind: 'avatar-intent', intent: 'recall' };
  }

  if (parsed.intent === 'utterance') {
    if (typeof parsed.text !== 'string') {
      return null;
    }

    return { kind: 'avatar-intent', intent: 'utterance', text: parsed.text };
  }

  if (parsed.intent === 'stop') {
    return { kind: 'avatar-intent', intent: 'stop' };
  }

  if (parsed.intent === 'tap') {
    return { kind: 'avatar-intent', intent: 'tap' };
  }

  return null;
}

export function createAvatarIntentHandler(
  actions: AvatarIntentActions,
): (intent: AvatarIntent) => void {
  return (intent: AvatarIntent) => {
    switch (intent.intent) {
      case 'pull-recap':
        actions.pullRecap();
        return;
      case 'recall':
        actions.recall();
        return;
      case 'utterance':
        actions.utterance(intent.text);
        return;
      case 'stop':
        actions.stop();
        return;
      case 'tap':
        actions.tap();
        return;
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
