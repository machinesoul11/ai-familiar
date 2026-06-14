import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTtsRequest } from './elevenLabsRequest.js';
import type { ElevenLabsSettings } from './ttsConfig.js';
import type { SpeechBackend } from './ttsChannel.js';

const FETCH_TIMEOUT_MS = 20_000;

export function createElevenLabsBackend(settings: ElevenLabsSettings): SpeechBackend {
  // The serializer keeps at most one utterance in flight, so at any moment a
  // single speakAsync owns the current fetch controller and/or afplay child.
  // stop() (5.4b barge-in) aborts the fetch (so a just-fetched clip never plays)
  // and kills the playing child.
  const handle: PlaybackHandle = { controller: null, child: null };

  return {
    speak(text: string): Promise<void> {
      try {
        if (typeof text !== 'string' || text.trim() === '') {
          return Promise.resolve();
        }

        return speakAsync(text, settings, handle);
      } catch {
        // Speech backends are best-effort and must not crash callers.
        return Promise.resolve();
      }
    },
    stop(): void {
      // Abort an in-flight fetch and kill a playing child. Whichever phase is
      // active settles speakAsync, so the serializer's pump advances and idles.
      try {
        handle.controller?.abort();
      } catch {
        // Best-effort.
      }
      if (handle.child) {
        try {
          handle.child.kill('SIGTERM');
        } catch {
          // Best-effort.
        }
      }
    },
  };
}

interface PlaybackHandle {
  controller: AbortController | null;
  child: ChildProcess | null;
}

async function speakAsync(
  text: string,
  settings: ElevenLabsSettings,
  handle: PlaybackHandle,
): Promise<void> {
  let filePath: string | undefined;
  const controller = new AbortController();
  handle.controller = controller;
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const req = buildTtsRequest({ text, settings });
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: controller.signal,
    });

    if (!res.ok) {
      return;
    }

    const audio = Buffer.from(await res.arrayBuffer());
    clearTimeout(timeout);

    filePath = join(tmpdir(), `familiar-elevenlabs-${randomUUID()}.mp3`);
    await writeFile(filePath, audio);

    const child = spawn('afplay', [filePath], {
      detached: true,
      stdio: 'ignore',
    });
    handle.child = child;

    await new Promise<void>((resolve) => {
      let settled = false;

      const cleanup = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (handle.child === child) {
          handle.child = null;
        }

        if (filePath) {
          void unlink(filePath).catch(() => {});
        }

        resolve();
      };

      child.once('error', cleanup);
      child.once('close', cleanup);
      child.unref();
    });
  } catch {
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
  } finally {
    clearTimeout(timeout);
    if (handle.controller === controller) {
      handle.controller = null;
    }
  }
}
