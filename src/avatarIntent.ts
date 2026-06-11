export type AvatarIntent =
  | { kind: 'avatar-intent'; intent: 'pull-recap' };

export interface AvatarIntentActions {
  pullRecap: () => void;
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

  if (parsed.intent !== 'pull-recap') {
    return null;
  }

  return { kind: 'avatar-intent', intent: 'pull-recap' };
}

export function createAvatarIntentHandler(
  actions: AvatarIntentActions,
): (intent: AvatarIntent) => void {
  return (intent: AvatarIntent) => {
    switch (intent.intent) {
      case 'pull-recap':
        actions.pullRecap();
        return;
    }
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
