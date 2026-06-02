import { spawn } from 'node:child_process';
import { buildNotificationScript } from './osaNotify.js';
import type { NotificationBackend } from './notificationChannel.js';

export function createOsaNotifyBackend(): NotificationBackend {
  return {
    notify(title: string, body: string): void {
      try {
        const script = buildNotificationScript(title, body);
        const child = spawn('osascript', ['-e', script], {
          detached: true,
          stdio: 'ignore'
        });

        child.on('error', () => {});
        child.unref();
      } catch {
        // OS notification delivery is best-effort.
      }
    }
  };
}
