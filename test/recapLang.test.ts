import { describe, it, expect } from 'vitest';
import { resolveRecapLang, localizedRecapLine, TARGET_RECAP_LANGS } from '../src/recapLang.js';
import type { ArchSummary } from '../src/summary.js';

function buildSummary(v: number, p: number, m: number, c: number): ArchSummary {
  return {
    kind: 'arch-summary',
    violations: Array(v).fill(1),
    protectedHits: Array(p).fill(1),
    modules: Array(m).fill(1),
    newCouplings: Array(c).fill(1),
  };
}

describe('recapLang', () => {
  describe('resolveRecapLang', () => {
    it('AC1: resolves missing/invalid/unsupported to "en"', () => {
      expect(resolveRecapLang({})).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: '' })).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: '   ' })).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'en' })).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'EN' })).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'pt' })).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'es-ES' })).toBe('en');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'japanese' })).toBe('en');
      // @ts-expect-error testing invalid types
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 123 })).toBe('en');
    });

    it('AC1: resolves valid target languages regardless of casing/spacing', () => {
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'es' })).toBe('es');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'ES' })).toBe('es');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: ' es ' })).toBe('es');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'Es' })).toBe('es');
      
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'fr' })).toBe('fr');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'de' })).toBe('de');
      expect(resolveRecapLang({ FAMILIAR_RECAP_LANG: 'ja' })).toBe('ja');
    });
    
    it('TARGET_RECAP_LANGS exported correctly', () => {
        expect(TARGET_RECAP_LANGS).toEqual(['es', 'fr', 'de', 'ja']);
    });
  });

  describe('localizedRecapLine', () => {
    const vectors = {
      es: {
        A: 'Ejecución finalizada. Sin cambios arquitectónicos.',
        B: 'Ejecución finalizada: 1 violación de límite, 1 zona protegida modificada, 1 módulo cambiado, 1 nuevo acoplamiento entre módulos.',
        C: 'Ejecución finalizada: 2 violaciones de límite, 3 zonas protegidas modificadas, 4 módulos cambiados, 5 nuevos acoplamientos entre módulos.',
        D: 'Ejecución finalizada: 3 módulos cambiados.',
        E1: 'Ejecución finalizada: 1 violación de límite, 2 módulos cambiados. 1 subagente finalizado.',
        E3: 'Ejecución finalizada: 1 violación de límite, 2 módulos cambiados. 3 subagentes finalizados.',
        F: 'Ejecución finalizada. Sin cambios arquitectónicos. 2 subagentes finalizados.'
      },
      fr: {
        A: 'Exécution terminée. Aucun changement architectural.',
        B: 'Exécution terminée: 1 violation de limite, 1 zone protégée modifiée, 1 module modifié, 1 nouveau couplage entre modules.',
        C: 'Exécution terminée: 2 violations de limite, 3 zones protégées modifiées, 4 modules modifiés, 5 nouveaux couplages entre modules.',
        D: 'Exécution terminée: 3 modules modifiés.',
        E1: 'Exécution terminée: 1 violation de limite, 2 modules modifiés. 1 sous-agent terminé.',
        E3: 'Exécution terminée: 1 violation de limite, 2 modules modifiés. 3 sous-agents terminés.',
        F: 'Exécution terminée. Aucun changement architectural. 2 sous-agents terminés.'
      },
      de: {
        A: 'Lauf abgeschlossen. Keine architektonischen Änderungen.',
        B: 'Lauf abgeschlossen: 1 Grenzverletzung, 1 geschützte Zone berührt, 1 Modul geändert, 1 neue modulübergreifende Kopplung.',
        C: 'Lauf abgeschlossen: 2 Grenzverletzungen, 3 geschützte Zonen berührt, 4 Module geändert, 5 neue modulübergreifende Kopplungen.',
        D: 'Lauf abgeschlossen: 3 Module geändert.',
        E1: 'Lauf abgeschlossen: 1 Grenzverletzung, 2 Module geändert. 1 Subagent abgeschlossen.',
        E3: 'Lauf abgeschlossen: 1 Grenzverletzung, 2 Module geändert. 3 Subagenten abgeschlossen.',
        F: 'Lauf abgeschlossen. Keine architektonischen Änderungen. 2 Subagenten abgeschlossen.'
      },
      ja: {
        A: '実行が完了しました。アーキテクチャの変更はありません。',
        B: '実行が完了しました：境界違反1件、保護ゾーンの変更1件、モジュールの変更1件、モジュール間の新しい結合1件。',
        C: '実行が完了しました：境界違反2件、保護ゾーンの変更3件、モジュールの変更4件、モジュール間の新しい結合5件。',
        D: '実行が完了しました：モジュールの変更3件。',
        E1: '実行が完了しました：境界違反1件、モジュールの変更2件。 サブエージェント1件が完了しました。',
        E3: '実行が完了しました：境界違反1件、モジュールの変更2件。 サブエージェント3件が完了しました。',
        F: '実行が完了しました。アーキテクチャの変更はありません。 サブエージェント2件が完了しました。'
      }
    } as const;

    for (const lang of ['es', 'fr', 'de', 'ja'] as const) {
      describe(`Language: ${lang}`, () => {
        it('AC2-AC5, AC6: Vector A (0/0/0/0)', () => {
          expect(localizedRecapLine({ summary: buildSummary(0, 0, 0, 0), lang })).toBe(vectors[lang].A);
        });

        it('AC2-AC5, AC6: Vector B (1/1/1/1) - Singular', () => {
          expect(localizedRecapLine({ summary: buildSummary(1, 1, 1, 1), lang })).toBe(vectors[lang].B);
        });

        it('AC2-AC5, AC6: Vector C (2/3/4/5) - Plural', () => {
          expect(localizedRecapLine({ summary: buildSummary(2, 3, 4, 5), lang })).toBe(vectors[lang].C);
        });

        it('AC2-AC5, AC7: Vector D (0/0/3/0) - Skipping zeroes', () => {
          expect(localizedRecapLine({ summary: buildSummary(0, 0, 3, 0), lang })).toBe(vectors[lang].D);
        });

        it('AC2-AC5, AC8: Vector E1 (1/0/2/0, sub=1) - Singular subagent', () => {
          expect(localizedRecapLine({ summary: buildSummary(1, 0, 2, 0), subagentCount: 1, lang })).toBe(vectors[lang].E1);
        });

        it('AC2-AC5, AC8: Vector E3 (1/0/2/0, sub=3) - Plural subagent', () => {
          expect(localizedRecapLine({ summary: buildSummary(1, 0, 2, 0), subagentCount: 3, lang })).toBe(vectors[lang].E3);
        });

        it('AC2-AC5, AC8: Vector F (0/0/0/0, sub=2) - Empty summary with subagents', () => {
          expect(localizedRecapLine({ summary: buildSummary(0, 0, 0, 0), subagentCount: 2, lang })).toBe(vectors[lang].F);
        });
        
        it('AC8: Invalid subagent counts yield no suffix', () => {
            const sum = buildSummary(1, 0, 2, 0);
            const expected = localizedRecapLine({ summary: sum, lang });
            
            expect(localizedRecapLine({ summary: sum, subagentCount: 0, lang })).toBe(expected);
            expect(localizedRecapLine({ summary: sum, subagentCount: -1, lang })).toBe(expected);
            expect(localizedRecapLine({ summary: sum, subagentCount: 2.5, lang })).toBe(expected);
            expect(localizedRecapLine({ summary: sum, subagentCount: NaN, lang })).toBe(expected);
            // @ts-expect-error invalid type
            expect(localizedRecapLine({ summary: sum, subagentCount: '2', lang })).toBe(expected);
        });
      });
    }

    it('AC11: localizedRecapLine never throws', () => {
        expect(() => {
            localizedRecapLine({ summary: buildSummary(0, 0, 0, 0), lang: 'es' });
            localizedRecapLine({ summary: buildSummary(10, 20, 30, 40), subagentCount: 999, lang: 'ja' });
        }).not.toThrow();
    });
  });
});
