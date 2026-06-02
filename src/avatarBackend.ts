import type { AvatarBackend, AvatarCommand } from './avatarChannel.js';

export interface FrameSink {
  write(line: string): void;
}

export function encodeAvatarCommand(command: AvatarCommand): string {
  return `${JSON.stringify(command)}\n`;
}

export function createAvatarBackend(sink: FrameSink): AvatarBackend {
  return {
    render(command: AvatarCommand): void {
      try {
        sink.write(encodeAvatarCommand(command));
      } catch {
        // Fire-and-forget backend writes must not crash the daemon.
      }
    },
  };
}
