import { describe, it, expect } from 'vitest';
import { encodeAvatarCommand, createAvatarBackend } from '../src/avatarBackend.js';
import type { FrameSink } from '../src/avatarBackend.js';
import { createAvatarChannel } from '../src/avatarChannel.js';
import type { AvatarCommand } from '../src/avatarChannel.js';
import type { ChannelMessage } from '../src/channel.js';

describe('Avatar Backend', () => {
  describe('encodeAvatarCommand — byte-exact wire format', () => {
    it('AC 1: encode state command (working)', () => {
      const cmd: AvatarCommand = { kind: 'state', phase: 'working', ready: true };
      expect(encodeAvatarCommand(cmd)).toBe('{"kind":"state","phase":"working","ready":true}\n');
    });

    it('AC 2: encode state command (idle)', () => {
      const cmd: AvatarCommand = { kind: 'state', phase: 'idle', ready: false };
      expect(encodeAvatarCommand(cmd)).toBe('{"kind":"state","phase":"idle","ready":false}\n');
    });

    it('AC 3: encode expression command', () => {
      const cmd: AvatarCommand = { kind: 'expression', mood: 'alert' };
      expect(encodeAvatarCommand(cmd)).toBe('{"kind":"expression","mood":"alert"}\n');
    });

    it('AC 4: encode thought command', () => {
      const cmd: AvatarCommand = { kind: 'thought', text: 'Refactoring.' };
      expect(encodeAvatarCommand(cmd)).toBe('{"kind":"thought","text":"Refactoring."}\n');
    });

    it('AC 5: ends with exactly one newline and no other surrounding whitespace', () => {
      const cmd: AvatarCommand = { kind: 'expression', mood: 'neutral' };
      const frame = encodeAvatarCommand(cmd);
      expect(frame.endsWith('\n')).toBe(true);
      expect(frame.slice(0, -1).includes('\n')).toBe(false);
      expect(frame.trimStart()).toBe(frame);
    });

    it('AC 6: newline-safety for multiline thoughts', () => {
      const cmd: AvatarCommand = { kind: 'thought', text: 'a\nb' };
      const frame = encodeAvatarCommand(cmd);
      const lines = frame.split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[1]).toBe('');
      expect(JSON.parse(frame).text).toBe('a\nb');
    });

    it('AC 7: round-trip for all command kinds', () => {
      const commands: AvatarCommand[] = [
        { kind: 'state', phase: 'done', ready: true },
        { kind: 'expression', mood: 'happy' },
        { kind: 'thought', text: 'Thinking...' }
      ];
      for (const cmd of commands) {
        expect(JSON.parse(encodeAvatarCommand(cmd))).toEqual(cmd);
      }
    });

    it('AC 8: special characters in thought text', () => {
      const text = 'he said "hi"\t🦊';
      const cmd: AvatarCommand = { kind: 'thought', text };
      const frame = encodeAvatarCommand(cmd);
      expect(JSON.parse(frame).text).toBe(text);
    });
  });

  describe('createAvatarBackend — the real backend', () => {
    const createRecordingSink = () => ({
      lines: [] as string[],
      write(line: string) { this.lines.push(line); }
    });

    const throwingSink: FrameSink = {
      write() { throw new Error('boom'); }
    };

    it('AC 9: returns a value satisfying AvatarBackend (has render)', () => {
      const backend = createAvatarBackend(createRecordingSink());
      expect(typeof backend.render).toBe('function');
    });

    it('AC 10: render state command calls sink.write exactly once with byte-exact string', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      backend.render({ kind: 'state', phase: 'working', ready: true });
      expect(sink.lines).toHaveLength(1);
      expect(sink.lines[0]).toBe('{"kind":"state","phase":"working","ready":true}\n');
    });

    it('AC 11: render expression and thought commands each call sink.write once', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      
      backend.render({ kind: 'expression', mood: 'thinking' });
      expect(sink.lines[sink.lines.length - 1]).toBe('{"kind":"expression","mood":"thinking"}\n');
      
      backend.render({ kind: 'thought', text: 'Analyzing...' });
      expect(sink.lines[sink.lines.length - 1]).toBe('{"kind":"thought","text":"Analyzing..."}\n');
      
      expect(sink.lines).toHaveLength(2);
    });

    it('AC 12: ordering of multiple render calls', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      
      backend.render({ kind: 'state', phase: 'idle', ready: false });
      backend.render({ kind: 'expression', mood: 'alert' });
      backend.render({ kind: 'thought', text: 'Ready.' });

      expect(sink.lines).toEqual([
        '{"kind":"state","phase":"idle","ready":false}\n',
        '{"kind":"expression","mood":"alert"}\n',
        '{"kind":"thought","text":"Ready."}\n'
      ]);
    });

    it('AC 13: throwing sink is swallowed by render', () => {
      const backend = createAvatarBackend(throwingSink);
      expect(() => {
        backend.render({ kind: 'expression', mood: 'neutral' });
      }).not.toThrow();
    });

    it('AC 14: render returns undefined and construction does not call write', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      expect(sink.lines).toHaveLength(0);
      
      const result = backend.render({ kind: 'expression', mood: 'neutral' });
      expect(result).toBeUndefined();
    });
  });

  describe('Seam-integration — 4.1 channel + 4.2a backend', () => {
    const createRecordingSink = () => ({
      lines: [] as string[],
      write(line: string) { this.lines.push(line); }
    });

    it('AC 15: valid delivery projects to the wire', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      const channel = createAvatarChannel(backend);

      channel.deliver({ kind: 'avatar-state', phase: 'blocked', ready: true });
      expect(sink.lines).toEqual(['{"kind":"state","phase":"blocked","ready":true}\n']);
    });

    it('AC 16: invalid message is dropped before the wire', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      const channel = createAvatarChannel(backend);

      channel.deliver({ kind: 'avatar-state', phase: 'frobnicate', ready: true } as unknown as ChannelMessage);
      expect(sink.lines).toHaveLength(0);
    });

    it('AC 17: validation rules (whitespace thought / happy expression)', () => {
      const sink = createRecordingSink();
      const backend = createAvatarBackend(sink);
      const channel = createAvatarChannel(backend);

      // Whitespace thought should be dropped by the channel
      channel.deliver({ kind: 'avatar-thought', text: '   ' });
      expect(sink.lines).toHaveLength(0);

      // Valid expression should go through
      channel.deliver({ kind: 'avatar-expression', mood: 'happy' });
      expect(sink.lines).toEqual(['{"kind":"expression","mood":"happy"}\n']);
    });
  });
});
