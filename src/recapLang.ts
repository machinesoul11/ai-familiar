import type { ArchSummary } from './summary.js';

export type TargetRecapLang = 'es' | 'fr' | 'de' | 'ja';
export type RecapLang = 'en' | TargetRecapLang;

export const TARGET_RECAP_LANGS: readonly TargetRecapLang[] = ['es', 'fr', 'de', 'ja'];

type LatinLang = Exclude<TargetRecapLang, 'ja'>;
type CountKey = 'violations' | 'protectedHits' | 'modules' | 'newCouplings';

const COUNT_KEYS: readonly CountKey[] = ['violations', 'protectedHits', 'modules', 'newCouplings'];

const LATIN_CATALOG: Record<LatinLang, {
  prefix: string;
  noChanges: string;
  clauses: Record<CountKey, { singular: string; plural: string }>;
  subagent: { singular: string; plural: string };
}> = {
  es: {
    prefix: 'Ejecución finalizada',
    noChanges: 'Sin cambios arquitectónicos.',
    clauses: {
      violations: {
        singular: 'violación de límite',
        plural: 'violaciones de límite',
      },
      protectedHits: {
        singular: 'zona protegida modificada',
        plural: 'zonas protegidas modificadas',
      },
      modules: {
        singular: 'módulo cambiado',
        plural: 'módulos cambiados',
      },
      newCouplings: {
        singular: 'nuevo acoplamiento entre módulos',
        plural: 'nuevos acoplamientos entre módulos',
      },
    },
    subagent: {
      singular: 'subagente finalizado',
      plural: 'subagentes finalizados',
    },
  },
  fr: {
    prefix: 'Exécution terminée',
    noChanges: 'Aucun changement architectural.',
    clauses: {
      violations: {
        singular: 'violation de limite',
        plural: 'violations de limite',
      },
      protectedHits: {
        singular: 'zone protégée modifiée',
        plural: 'zones protégées modifiées',
      },
      modules: {
        singular: 'module modifié',
        plural: 'modules modifiés',
      },
      newCouplings: {
        singular: 'nouveau couplage entre modules',
        plural: 'nouveaux couplages entre modules',
      },
    },
    subagent: {
      singular: 'sous-agent terminé',
      plural: 'sous-agents terminés',
    },
  },
  de: {
    prefix: 'Lauf abgeschlossen',
    noChanges: 'Keine architektonischen Änderungen.',
    clauses: {
      violations: {
        singular: 'Grenzverletzung',
        plural: 'Grenzverletzungen',
      },
      protectedHits: {
        singular: 'geschützte Zone berührt',
        plural: 'geschützte Zonen berührt',
      },
      modules: {
        singular: 'Modul geändert',
        plural: 'Module geändert',
      },
      newCouplings: {
        singular: 'neue modulübergreifende Kopplung',
        plural: 'neue modulübergreifende Kopplungen',
      },
    },
    subagent: {
      singular: 'Subagent abgeschlossen',
      plural: 'Subagenten abgeschlossen',
    },
  },
};

const JA_CLAUSES: Record<CountKey, string> = {
  violations: '境界違反',
  protectedHits: '保護ゾーンの変更',
  modules: 'モジュールの変更',
  newCouplings: 'モジュール間の新しい結合',
};

export function resolveRecapLang(env: Record<string, string | undefined>): RecapLang {
  const raw = env.FAMILIAR_RECAP_LANG;
  if (typeof raw !== 'string') {
    return 'en';
  }

  const normalized = raw.trim().toLowerCase();
  return isTargetRecapLang(normalized) ? normalized : 'en';
}

export function localizedRecapLine(input: {
  summary: ArchSummary;
  subagentCount?: number;
  lang: TargetRecapLang;
}): string {
  const counts = {
    violations: input.summary.violations.length,
    protectedHits: input.summary.protectedHits.length,
    modules: input.summary.modules.length,
    newCouplings: input.summary.newCouplings.length,
  };

  const line = input.lang === 'ja'
    ? japaneseLine(counts)
    : latinLine(input.lang, counts);

  if (!shouldAppendSubagent(input.subagentCount)) {
    return line;
  }

  return `${line} ${subagentSentence(input.lang, input.subagentCount)}`;
}

function isTargetRecapLang(value: string): value is TargetRecapLang {
  return (TARGET_RECAP_LANGS as readonly string[]).includes(value);
}

function latinLine(lang: LatinLang, counts: Record<CountKey, number>): string {
  const catalog = LATIN_CATALOG[lang];
  const clauses = COUNT_KEYS
    .map((key) => latinClause(catalog.clauses[key], counts[key]))
    .filter((clause): clause is string => clause !== null);

  if (clauses.length === 0) {
    return `${catalog.prefix}. ${catalog.noChanges}`;
  }

  return `${catalog.prefix}: ${clauses.join(', ')}.`;
}

function latinClause(
  phrase: { singular: string; plural: string },
  count: number,
): string | null {
  if (count <= 0) {
    return null;
  }

  return `${count} ${count === 1 ? phrase.singular : phrase.plural}`;
}

function japaneseLine(counts: Record<CountKey, number>): string {
  const clauses = COUNT_KEYS
    .map((key) => japaneseClause(JA_CLAUSES[key], counts[key]))
    .filter((clause): clause is string => clause !== null);

  if (clauses.length === 0) {
    return '実行が完了しました。アーキテクチャの変更はありません。';
  }

  return `実行が完了しました：${clauses.join('、')}。`;
}

function japaneseClause(noun: string, count: number): string | null {
  if (count <= 0) {
    return null;
  }

  return `${noun}${count}件`;
}

function shouldAppendSubagent(subagentCount: number | undefined): subagentCount is number {
  return (
    typeof subagentCount === 'number' &&
    Number.isInteger(subagentCount) &&
    subagentCount > 0
  );
}

function subagentSentence(lang: TargetRecapLang, subagentCount: number): string {
  if (lang === 'ja') {
    return `サブエージェント${subagentCount}件が完了しました。`;
  }

  const phrase = subagentCount === 1
    ? LATIN_CATALOG[lang].subagent.singular
    : LATIN_CATALOG[lang].subagent.plural;

  return `${subagentCount} ${phrase}.`;
}
