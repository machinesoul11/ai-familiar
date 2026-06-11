export type AvatarIntent =
  | { kind: 'avatar-intent'; intent: 'pull-recap' }
  | { kind: 'avatar-intent'; intent: 'recall' };

export interface AvatarIntentActions {
  pullRecap: () => void;
  recall: () => void;
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
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
