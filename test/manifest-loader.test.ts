import { describe, it, expect } from 'vitest';
import { parseManifest, MANIFEST_PATH } from '../src/manifestLoader.js';

describe('MANIFEST_PATH', () => {
  it('is the fixed per-repo manifest location', () => {
    // Criterion 13: MANIFEST_PATH === '.familiar/manifest.json'
    expect(MANIFEST_PATH).toBe('.familiar/manifest.json');
  });
});

describe('parseManifest', () => {
  describe('Defensive Totality (Absent & Malformed Input)', () => {
    it('returns empty object for null input (absent file)', () => {
      // Criterion 1: Absent -> {}
      expect(parseManifest(null)).toStrictEqual({});
    });

    it('returns empty object for malformed JSON', () => {
      // Criterion 3: Malformed JSON -> {}
      expect(parseManifest('{ not json')).toStrictEqual({});
      expect(parseManifest('{"unclosed": "brace"')).toStrictEqual({});
    });

    it('returns empty object for non-object top levels', () => {
      // Criterion 4: Non-object top level -> {}
      expect(parseManifest('42')).toStrictEqual({});
      expect(parseManifest('"a string"')).toStrictEqual({});
      expect(parseManifest('true')).toStrictEqual({});
      expect(parseManifest('null')).toStrictEqual({});
      expect(parseManifest('[1, 2, 3]')).toStrictEqual({});
    });

    it('returns empty object for valid but empty JSON object', () => {
      // Criterion 14: parseManifest('{}') -> {}
      expect(parseManifest('{}')).toStrictEqual({});
    });
  });

  describe('Field Presence Rules', () => {
    it('omits "protected" key if it is not an array', () => {
      // Criterion 5: protected not an array -> omitted
      const raw = JSON.stringify({ protected: 'src/x' });
      expect(parseManifest(raw)).toStrictEqual({});
    });

    it('omits "separate" key if it is not an array', () => {
      // Criterion 7: separate not an array -> omitted
      const raw = JSON.stringify({ separate: { from: 'a', to: 'b' } });
      expect(parseManifest(raw)).toStrictEqual({});
    });

    it('keeps keys even if they are empty after filtering', () => {
      // Criterion 12: Empty-after-filter keeps the key
      const raw = JSON.stringify({
        protected: [1, 2],
        separate: ["not an object"]
      });
      expect(parseManifest(raw)).toStrictEqual({
        protected: [],
        separate: []
      });
    });
  });

  describe('Type Coercion (protected)', () => {
    it('keeps only string elements in protected array, preserving order', () => {
      // Criterion 6: protected mixed types -> strings only
      const raw = JSON.stringify({
        protected: ["a", 1, true, "b", null, { obj: true }]
      });
      expect(parseManifest(raw)).toStrictEqual({
        protected: ["a", "b"]
      });
    });

    it('preserves empty strings in protected array', () => {
      // Criterion 11: Type coercion only (no semantic skip)
      const raw = JSON.stringify({ protected: [""] });
      expect(parseManifest(raw)).toStrictEqual({
        protected: [""]
      });
    });
  });

  describe('Type Coercion (separate)', () => {
    it('drops invalid elements and preserves valid rules in order', () => {
      // Criterion 8: separate drops invalid elements
      const raw = JSON.stringify({
        separate: [
          { from: 'a', to: 'b' },
          'not an object',
          null,
          [],
          { from: 'missing-to' },
          { to: 'missing-from' },
          { from: 1, to: 'b' }, // non-string from
          { from: 'a', to: 2 }, // non-string to
          { from: 'c', to: 'd' }
        ]
      });
      expect(parseManifest(raw)).toStrictEqual({
        separate: [
          { from: 'a', to: 'b' },
          { from: 'c', to: 'd' }
        ]
      });
    });

    it('keeps name iff it is a string', () => {
      // Criterion 9: name kept iff string
      const raw = JSON.stringify({
        separate: [
          { from: 'a', to: 'b', name: 'rule-1' },
          { from: 'c', to: 'd', name: 42 },
          { from: 'e', to: 'f', name: null },
          { from: 'g', to: 'h' }
        ]
      });
      expect(parseManifest(raw)).toStrictEqual({
        separate: [
          { from: 'a', to: 'b', name: 'rule-1' },
          { from: 'c', to: 'd' },
          { from: 'e', to: 'f' },
          { from: 'g', to: 'h' }
        ]
      });
    });

    it('preserves empty strings in from/to fields', () => {
      // Criterion 11: Type coercion only (no semantic skip)
      const raw = JSON.stringify({
        separate: [{ from: '', to: 'x' }]
      });
      expect(parseManifest(raw)).toStrictEqual({
        separate: [{ from: '', to: 'x' }]
      });
    });
  });

  describe('General Rules', () => {
    it('ignores unknown top-level keys', () => {
      // Criterion 10: Unknown top-level keys ignored
      const raw = JSON.stringify({
        protected: ['src/a'],
        extra: 'ignored',
        version: 1,
        nested: { key: 'value' }
      });
      expect(parseManifest(raw)).toStrictEqual({
        protected: ['src/a']
      });
    });

    it('handles a valid full manifest', () => {
      // Criterion 2: Valid full manifest
      const obj = {
        protected: ['a', 'b'],
        separate: [{ from: 'c', to: 'd', name: 'e' }]
      };
      expect(parseManifest(JSON.stringify(obj))).toStrictEqual(obj);
    });

    it('reproduces the worked example from the contract', () => {
      // Criterion 15: End-to-end worked example
      const raw = JSON.stringify({
        "protected": ["src/daemon", "src/ledger.ts", 42],
        "separate": [
          { "from": "src/ui", "to": "src/db", "name": "ui-no-db" },
          { "from": "src", "to": "src/avatar" },
          { "from": "x" },
          "nope",
          { "from": 1, "to": 2 },
          { "from": "a", "to": "b", "name": 99 }
        ],
        "extra": "ignored"
      });

      const expected = {
        protected: ['src/daemon', 'src/ledger.ts'],
        separate: [
          { from: 'src/ui', to: 'src/db', name: 'ui-no-db' },
          { from: 'src', to: 'src/avatar' },
          { from: 'a', to: 'b' },
        ],
      };

      expect(parseManifest(raw)).toStrictEqual(expected);
    });
  });
});
