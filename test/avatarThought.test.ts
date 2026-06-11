import { describe, it, expect } from 'vitest';
import { recapThought, decisionThought } from '../src/avatarThought.js';
import { shapeRecap } from '../src/shaper.js';
import { decisionMessage, NEEDS_PERMISSION_LINE, NEEDS_INPUT_LINE } from '../src/decisionMessage.js';
import type { ArchSummary } from '../src/summary.js';
import type { BoundaryViolation, ProtectedHit } from '../src/manifest.js';
import type { RoutedEvent } from '../src/bus.js';
import type { NormalizedEvent } from '../src/normalize.js';

describe('recapThought', () => {
  it('1. Returns { kind: "avatar-thought", text } and text === shapeRecap({ summary, finalMessage }).spokenLine for a representative non-empty summary', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [{} as ProtectedHit],
      violations: [{} as BoundaryViolation, {} as BoundaryViolation]
    };
    const finalMessage = null;
    const result = recapThought(summary, finalMessage);
    const expectedText = shapeRecap({ summary, finalMessage }).spokenLine;
    expect(result).toEqual({ kind: 'avatar-thought', text: expectedText });
  });

  it('2. Same twin equality holds when finalMessage is a non-empty string', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    const finalMessage = "Here is some final output.";
    const result = recapThought(summary, finalMessage);
    const expectedText = shapeRecap({ summary, finalMessage }).spokenLine;
    expect(result).toEqual({ kind: 'avatar-thought', text: expectedText });
  });

  it('3. Empty summary + finalMessage = null ⇒ text === "Run landed. No architectural changes." and kind === "avatar-thought"', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    const finalMessage = null;
    const result = recapThought(summary, finalMessage);
    expect(result.text).toBe('Run landed. No architectural changes.');
    expect(result.kind).toBe('avatar-thought');
  });

  it('4. text is always a non-empty string; kind is always "avatar-thought"; the function never returns null', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    const result = recapThought(summary, null);
    expect(result).not.toBeNull();
    expect(typeof result.text).toBe('string');
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.kind).toBe('avatar-thought');
  });

  it('5. Returns a fresh object each call (deep-equal but not reference-equal)', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    const result1 = recapThought(summary, null);
    const result2 = recapThought(summary, null);
    expect(result1).toEqual(result2);
    expect(result1).not.toBe(result2);
  });

  it('6. Does not mutate its inputs', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [{} as ProtectedHit],
      violations: []
    };
    const summaryClone = JSON.parse(JSON.stringify(summary));
    recapThought(summary, null);
    expect(summary).toEqual(summaryClone);
  });

  it('7. Never throws for any well-typed ArchSummary / string | null input', () => {
    const summary: ArchSummary = {
      kind: 'arch-summary',
      modules: [],
      newCouplings: [],
      protectedHits: [],
      violations: []
    };
    expect(() => recapThought(summary, "test")).not.toThrow();
    expect(() => recapThought(summary, null)).not.toThrow();
  });
});

describe('decisionThought', () => {
  it('8. A routed needs-permission decision over a notification event with a non-empty message ⇒ twin equality vs decisionMessage', () => {
    const event: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: 'Hello    world'
    } as any;
    const routed: RoutedEvent = { event, decision: { channel: 'notification', reason: 'needs-permission' } };
    
    const result = decisionThought(routed);
    const expectedMsg = decisionMessage(routed) as any;
    expect(result).toEqual({ kind: 'avatar-thought', text: expectedMsg.text });
    expect(result?.text).toBe('Hello world');
  });

  it('9. A routed needs-permission decision whose notification event message is empty/whitespace ⇒ text === NEEDS_PERMISSION_LINE', () => {
    const event: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: '   \n  '
    } as any;
    const routed: RoutedEvent = { event, decision: { channel: 'notification', reason: 'needs-permission' } };
    
    const result = decisionThought(routed);
    expect(result?.text).toBe(NEEDS_PERMISSION_LINE);
  });

  it('10. A routed needs-input decision ⇒ thought with text === NEEDS_INPUT_LINE when message empty, else the notification text', () => {
    const emptyEvent: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: ''
    } as any;
    const emptyRouted: RoutedEvent = { event: emptyEvent, decision: { channel: 'notification', reason: 'needs-input' } };
    const resultEmpty = decisionThought(emptyRouted);
    const expectedEmpty = decisionMessage(emptyRouted) as any;
    expect(resultEmpty).toEqual({ kind: 'avatar-thought', text: expectedEmpty.text });
    expect(resultEmpty?.text).toBe(NEEDS_INPUT_LINE);

    const nonEmptyEvent: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: 'Input required'
    } as any;
    const nonEmptyRouted: RoutedEvent = { event: nonEmptyEvent, decision: { channel: 'notification', reason: 'needs-input' } };
    const resultNonEmpty = decisionThought(nonEmptyRouted);
    const expectedNonEmpty = decisionMessage(nonEmptyRouted) as any;
    expect(resultNonEmpty).toEqual({ kind: 'avatar-thought', text: expectedNonEmpty.text });
  });

  it('11. A routed decision whose reason is not a needs-you reason ⇒ returns null', () => {
    const routedRunFinished: RoutedEvent = {
      event: { v: 1, kind: 'run-finished', hook: 'RunFinished', sessionId: 's', ts: 't', raw: {} as any } as any,
      decision: { channel: 'notification', reason: 'run-finished' }
    };
    expect(decisionThought(routedRunFinished)).toBeNull();

    const routedSilent: RoutedEvent = {
      event: { v: 1, kind: 'notification', hook: 'Notification', sessionId: 's', ts: 't', raw: {} as any, message: 'test' } as any,
      decision: { channel: 'none', reason: 'silent' }
    };
    expect(decisionThought(routedSilent)).toBeNull();

    const routedProgress: RoutedEvent = {
      event: { v: 1, kind: 'subagent-finished', hook: 'SubagentFinished', sessionId: 's', ts: 't', raw: {} as any } as any,
      decision: { channel: 'audio', reason: 'subagent-progress' }
    };
    expect(decisionThought(routedProgress)).toBeNull();
  });

  it('12. For every needs-you case, text equals the corresponding decisionMessage(routed).text exactly', () => {
    const event: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: 'Complex   message \n here'
    } as any;
    const routed: RoutedEvent = { event, decision: { channel: 'notification', reason: 'needs-permission' } };
    
    const result = decisionThought(routed);
    const expectedMsg = decisionMessage(routed) as any;
    expect(result?.text).toBe(expectedMsg.text);
  });

  it('13. Returns a fresh object each call for the non-null cases', () => {
    const event: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: 'test'
    } as any;
    const routed: RoutedEvent = { event, decision: { channel: 'notification', reason: 'needs-permission' } };
    
    const result1 = decisionThought(routed);
    const result2 = decisionThought(routed);
    expect(result1).toEqual(result2);
    expect(result1).not.toBe(result2);
  });

  it('14. Does not mutate its input routed. Never throws', () => {
    const event: NormalizedEvent = {
      v: 1,
      kind: 'notification',
      hook: 'Notification',
      sessionId: 's',
      ts: 't',
      raw: {} as any,
      message: 'test'
    } as any;
    const routed: RoutedEvent = { event, decision: { channel: 'notification', reason: 'needs-permission' } };
    
    const routedClone = JSON.parse(JSON.stringify(routed));
    expect(() => decisionThought(routed)).not.toThrow();
    expect(routed).toEqual(routedClone);
  });
});
