import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildTtsRequest } from './elevenLabsRequest.js';
import type { ElevenLabsSettings } from './ttsConfig.js';
import type { SpeechBackend } from './ttsChannel.js';

const FETCH_TIMEOUT_MS = 20_000;

export function createElevenLabsBackend(settings: ElevenLabsSettings): SpeechBackend {
  return {
    speak(text: string): void {
      try {
        if (typeof text !== 'string' || text.trim() === '') {
          return;
        }

        void speakAsync(text, settings);
      } catch {
        // Speech backends are best-effort and must not crash callers.
      }
    },
  };
}

async function speakAsync(text: string, settings: ElevenLabsSettings): Promise<void> {
  let filePath: string | undefined;
  const controller = new AbortController();
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
    filePath = join(tmpdir(), `familiar-elevenlabs-${randomUUID()}.mp3`);
    await writeFile(filePath, audio);

    const child = spawn('afplay', [filePath], {
      detached: true,
      stdio: 'ignore',
    });

    child.on('error', () => {});
    child.on('close', () => {
      if (filePath) {
        void unlink(filePath).catch(() => {});
      }
    });
    child.unref();
  } catch {
    if (filePath) {
      await unlink(filePath).catch(() => {});
    }
  } finally {
    clearTimeout(timeout);
  }
}
