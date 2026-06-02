import { describe, it, expect } from 'vitest';
import { createNotificationChannel, type NotificationBackend } from '../src/notificationChannel.js';
import { buildNotificationScript } from '../src/osaNotify.js';
import type { DeliveryChannel, ChannelMessage, NotificationMessage } from '../src/channel.js';

describe('notification channel adapter', () => {
  const createRecordingBackend = () => ({
    calls: [] as Array<{ title: string; body: string }>,
    notify(t: string, b: string) {
      this.calls.push({ title: t, body: b });
    }
  });

  const createThrowingBackend = (): NotificationBackend => ({
    notify() {
      throw new Error('boom');
    }
  });

  it('1. has kind "notification" and satisfies DeliveryChannel', () => {
    const backend = createRecordingBackend();
    const channel: DeliveryChannel = createNotificationChannel(backend);
    expect(channel.kind).toBe('notification');
    expect(typeof channel.deliver).toBe('function');
  });

  it('2. delivers a notification message to the backend', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);
    const msg: NotificationMessage = {
      kind: 'notification',
      title: 'Run landed',
      body: '4 modules changed'
    };

    channel.deliver(msg);

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0]).toEqual({ title: 'Run landed', body: '4 modules changed' });
  });

  it('3. passes strings verbatim (preserving spaces)', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);
    
    channel.deliver({ kind: 'notification', title: ' Hi ', body: ' yo ' });

    expect(backend.calls[0]).toEqual({ title: ' Hi ', body: ' yo ' });
  });

  it('4. ignores non-notification messages (e.g. spoken)', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);
    const msg = { kind: 'spoken', text: 'x' } as unknown as ChannelMessage;

    channel.deliver(msg);

    expect(backend.calls).toHaveLength(0);
  });

  it('5. skips delivery when both title and body are empty or whitespace', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);

    channel.deliver({ kind: 'notification', title: '', body: '' });
    channel.deliver({ kind: 'notification', title: '  ', body: '\n' });

    expect(backend.calls).toHaveLength(0);
  });

  it('6. delivers if title is present but body is empty', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);

    channel.deliver({ kind: 'notification', title: 'Done', body: '' });

    expect(backend.calls).toEqual([{ title: 'Done', body: '' }]);
  });

  it('7. delivers if body is present but title is empty', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);

    channel.deliver({ kind: 'notification', title: '', body: 'blocked' });

    expect(backend.calls).toEqual([{ title: '', body: 'blocked' }]);
  });

  it('8. coerces non-string fields to empty strings', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);

    // title:42 -> ''
    channel.deliver({ kind: 'notification', title: 42, body: 'hi' } as unknown as ChannelMessage);
    // body:null -> ''
    channel.deliver({ kind: 'notification', title: 'hi', body: null } as unknown as ChannelMessage);
    // both non-string -> skip (since both become '')
    channel.deliver({ kind: 'notification', title: true, body: {} } as unknown as ChannelMessage);

    expect(backend.calls).toHaveLength(2);
    expect(backend.calls[0]).toEqual({ title: '', body: 'hi' });
    expect(backend.calls[1]).toEqual({ title: 'hi', body: '' });
  });

  it('9. swallows backend errors', () => {
    const channel = createNotificationChannel(createThrowingBackend());
    const msg: NotificationMessage = { kind: 'notification', title: 't', body: 'b' };

    expect(() => channel.deliver(msg)).not.toThrow();
  });

  it('10. returns undefined and delivers multiple messages in order', () => {
    const backend = createRecordingBackend();
    const channel = createNotificationChannel(backend);

    const r1 = channel.deliver({ kind: 'notification', title: '1', body: '1' });
    const r2 = channel.deliver({ kind: 'notification', title: '2', body: '2' });
    const r3 = channel.deliver({ kind: 'notification', title: '3', body: '3' });

    expect(r1).toBeUndefined();
    expect(r2).toBeUndefined();
    expect(r3).toBeUndefined();
    expect(backend.calls).toEqual([
      { title: '1', body: '1' },
      { title: '2', body: '2' },
      { title: '3', body: '3' }
    ]);
  });

  it('11. does not call notify during construction', () => {
    const backend = createRecordingBackend();
    createNotificationChannel(backend);
    expect(backend.calls).toHaveLength(0);
  });

  it('12. is total: no input combination makes deliver throw', () => {
    const channel = createNotificationChannel(createRecordingBackend());
    
    // Exhaustive variety of bad inputs via cast
    expect(() => channel.deliver({} as any)).not.toThrow();
    expect(() => channel.deliver({ kind: 'notification' } as any)).not.toThrow();
    expect(() => channel.deliver({ kind: 'other' } as any)).not.toThrow();
  });
});

describe('osaNotify script builder', () => {
  it('13. builds plain notification script correctly', () => {
    const result = buildNotificationScript('Run landed', '4 modules changed');
    expect(result).toBe('display notification "4 modules changed" with title "Run landed"');
  });

  it('14. escapes double quotes in body', () => {
    const result = buildNotificationScript('T', 'He said "hi"');
    expect(result).toBe('display notification "He said \\\"hi\\\"" with title "T"');
  });

  it('15. escapes backslashes and handles backslash-then-quote combination', () => {
    // Single backslash input -> double backslash output
    const r1 = buildNotificationScript('T', 'a\\b');
    expect(r1).toBe('display notification "a\\\\b" with title "T"');

    // Backslash then quote: a\"b -> a\\\"b
    const r2 = buildNotificationScript('T', 'a\\"b');
    expect(r2).toBe('display notification "a\\\\\\\"b" with title "T"');
  });

  it('16. replaces \r and \n with a single space', () => {
    const r1 = buildNotificationScript('T', 'line1\nline2');
    expect(r1).toBe('display notification "line1 line2" with title "T"');

    const r2 = buildNotificationScript('T', 'line1\rline2');
    expect(r2).toBe('display notification "line1 line2" with title "T"');

    // Let's check a mixed case
    const r4 = buildNotificationScript('T', 'a\rb\nc');
    expect(r4).toBe('display notification "a b c" with title "T"');
  });

  it('17. handles empty title and body', () => {
    const result = buildNotificationScript('', '');
    expect(result).toBe('display notification "" with title ""');
  });

  it('18. is deterministic and total', () => {
    const t = 'Title 🚀';
    const b = 'Body \u1234';
    const r1 = buildNotificationScript(t, b);
    const r2 = buildNotificationScript(t, b);
    
    expect(r1).toBe(r2);
    expect(typeof r1).toBe('string');
    expect(r1).toContain('Title 🚀');
    expect(r1).toContain('Body \u1234');
  });
});
