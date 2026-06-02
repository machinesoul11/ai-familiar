/*
 * avatar-drive.ts — by-eye driver for the native avatar overlay (Phase 4.2b).
 *
 * Stands up the REAL 4.2a publish socket ($FAMILIAR_HOME/avatar.sock) and pushes
 * frames through the REAL 4.1 + 4.2a pipeline
 *   createAvatarChannel(createAvatarBackend(pub.sink))
 * so what the Swift overlay receives is byte-identical to what the daemon will
 * emit once 4.2c wires this in. This is the 4.2b analogue of the 4.2a loopback.
 *
 * Run (no build needed):   npx tsx scripts/avatar-drive.ts [--seq]
 * Then launch the overlay:  avatar/.build/debug/FamiliarAvatar
 * (both default to $FAMILIAR_HOME/avatar.sock, so no flags needed).
 *
 * Interactive commands on stdin:
 *   state <idle|working|blocked|done> [ready]   e.g.  state working
 *                                                     state blocked ready
 *   expression <neutral|happy|thinking|alert>   e.g.  expression alert
 *   thought <free text...>                       e.g.  thought refactoring the router
 *   seq                                          run the scripted demo once
 *   quit
 */
import { createInterface } from 'node:readline';
import { createAvatarPublishSocket } from '../src/avatarPublishSocket.js';
import { createAvatarBackend } from '../src/avatarBackend.js';
import { createAvatarChannel } from '../src/avatarChannel.js';
import type { ChannelMessage } from '../src/channel.js';

const pub = createAvatarPublishSocket();
const channel = createAvatarChannel(createAvatarBackend(pub.sink));

const send = (message: ChannelMessage): void => channel.deliver(message);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function runSequence(): Promise<void> {
  console.log('[drive] sequence: idle → working → (thinking) → blocked+ready → (alert) → done → happy');
  send({ kind: 'avatar-state', phase: 'idle', ready: false });
  await sleep(2500);
  send({ kind: 'avatar-state', phase: 'working', ready: false });
  await sleep(2500);
  send({ kind: 'avatar-expression', mood: 'thinking' });
  await sleep(2500);
  send({ kind: 'avatar-state', phase: 'blocked', ready: true });
  send({ kind: 'avatar-thought', text: 'I need a decision on the schema. 🦊' });
  await sleep(3000);
  send({ kind: 'avatar-expression', mood: 'alert' });
  await sleep(2500);
  send({ kind: 'avatar-state', phase: 'done', ready: false });
  await sleep(1500);
  send({ kind: 'avatar-expression', mood: 'happy' });
  console.log('[drive] sequence complete');
}

function handleLine(line: string): boolean {
  const parts = line.trim().split(/\s+/);
  const cmd = parts[0];
  if (!cmd) return true;

  switch (cmd) {
    case 'state': {
      const phase = parts[1] as 'idle' | 'working' | 'blocked' | 'done';
      const ready = parts[2] === 'ready' || parts[2] === 'true';
      send({ kind: 'avatar-state', phase, ready });
      console.log(`[drive] state ${phase} ready=${ready}`);
      return true;
    }
    case 'expression': {
      const mood = parts[1] as 'neutral' | 'happy' | 'thinking' | 'alert';
      send({ kind: 'avatar-expression', mood });
      console.log(`[drive] expression ${mood}`);
      return true;
    }
    case 'thought': {
      const text = line.trim().slice('thought'.length).trim();
      send({ kind: 'avatar-thought', text });
      console.log(`[drive] thought ${JSON.stringify(text)}`);
      return true;
    }
    case 'seq':
      void runSequence();
      return true;
    case 'quit':
    case 'exit':
      return false;
    default:
      console.log(`[drive] unknown command: ${cmd}`);
      return true;
  }
}

async function main(): Promise<void> {
  await pub.start();
  console.log(`[drive] publishing on ${pub.socketPath}`);
  console.log('[drive] launch the overlay, then type commands (or `seq`, `quit`).');

  if (process.argv.includes('--seq')) {
    await runSequence();
  }

  const rl = createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    if (!handleLine(line)) {
      rl.close();
    }
  });
  rl.on('close', () => void shutdown());
}

let shuttingDown = false;
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n[drive] stopping…');
  await pub.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

void main();
