import type { AvatarIntent } from './avatarIntent.js';
import { classifyUtterance } from './utterance.js';

export type IntentAction = 'pull-recap' | 'recall' | 'stop' | 'none';

export interface IntentPolicyConfig {
  stt: boolean;
  stop: boolean;
}

export function resolveIntentAction(
  intent: AvatarIntent,
  config: IntentPolicyConfig,
  isSpeaking: boolean,
): IntentAction {
  switch (intent.intent) {
    case 'pull-recap':
      return 'pull-recap';
    case 'recall':
      return 'recall';
    case 'stop':
      return config.stop ? 'stop' : 'none';
    case 'tap':
      return isSpeaking ? (config.stop ? 'stop' : 'none') : 'pull-recap';
    case 'utterance': {
      if (!config.stt) {
        return 'none';
      }

      const classified = classifyUtterance(intent.text);
      switch (classified) {
        case 'pull-recap':
          return 'pull-recap';
        case 'recall':
          return 'recall';
        case 'stop':
          return config.stop ? 'stop' : 'none';
        case null:
          return 'none';
      }
    }
  }
}
