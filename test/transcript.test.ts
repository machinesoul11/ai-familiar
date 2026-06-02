import { describe, it, expect } from 'vitest';
import { extractFinalMessage } from '../src/transcript.js';

describe('extractFinalMessage', () => {
  // AC1
  it("returns null for empty or whitespace-only input", () => {
    expect(extractFinalMessage('')).toBeNull();
    expect(extractFinalMessage('   \n  \t ')).toBeNull();
  });

  // AC2
  it("skips invalid JSON lines and returns null for all-garbage", () => {
    expect(extractFinalMessage('not json\n{bad json}\n')).toBeNull();
  });

  // AC3
  it("returns null when only non-assistant entries are present", () => {
    const raw = [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'hi' }] } },
      { type: 'system', message: { role: 'system', content: [{ type: 'text', text: 'sys' }] } },
      { type: 'last-prompt', text: 'prompt' },
      { type: 'ai-title', title: 'title' }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBeNull();
  });

  // AC4
  it("returns the exact text for a single assistant entry with one non-empty text block", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All done.' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe('All done.');
  });

  // AC5
  it("returns earlier text when followed by a trailing tool_use-only assistant entry", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: '123' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe('Earlier');
  });

  // AC6
  it("ignores non-assistant entries after the last assistant-with-text", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Earlier' }] } },
      { type: 'last-prompt', text: 'prompt' },
      { type: 'ai-title', title: 'title' }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe('Earlier');
  });

  // AC7
  it("extracts text when mixed with tool_use blocks", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'A' }, { type: 'tool_use', id: '123' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe('A');
  });

  // AC8
  it("ignores an assistant whose only text block is empty/whitespace", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '   ' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBeNull();
  });

  // AC9
  it("returns the last text from multiple assistant-with-text entries", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'second' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe('second');
  });

  // AC10
  it("concatenates multi-text-block messages without a separator", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe('AB');
  });

  // AC11
  it("preserves surrounding spaces inside a non-empty text block", () => {
    const raw = [
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: ' hi ' }] } }
    ].map(e => JSON.stringify(e)).join('\n');
    expect(extractFinalMessage(raw)).toBe(' hi ');
  });

  // AC12
  it("handles CRLF line endings, trailing blank lines, skips missing fields/non-array content, never throws, is deterministic", () => {
    const rawLines = [
      JSON.stringify({ type: 'assistant', missing_message: true }),
      JSON.stringify({ type: 'assistant', message: { content: 'not an array' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Valid' }] } })
    ];
    const raw = rawLines.join('\r\n') + '\r\n\r\n';
    
    const result1 = extractFinalMessage(raw);
    expect(result1).toBe('Valid');
    
    const result2 = extractFinalMessage(raw);
    expect(result2).toBe('Valid');
  });
});
