import type { MatchConfig } from '../../shared/protocol';
import { read, write } from './storage';

/** Meilleure partie solo pour un niveau et un format, gardée dans ce navigateur. */
export interface PersonalRecord {
  score: number;
  correct: number;
  total: number;
  fastestMs: number | null;
  avgMs: number;
  roundScores: number[];
  date: string; // ISO
}

export interface RecordOutcome {
  previous: PersonalRecord | null;
  isNew: boolean;
}

const RECORDS_KEY = 'tapout.records';
const recordKey = (c: MatchConfig) => `${c.level}|${c.format}`;

function allRecords(): Record<string, PersonalRecord> {
  try {
    return JSON.parse(read(RECORDS_KEY) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

export function getRecord(config: MatchConfig): PersonalRecord | null {
  return allRecords()[recordKey(config)] ?? null;
}

/**
 * Compare une partie terminée au record et l'enregistre si elle le bat.
 * Le verdict est mémorisé par partie : recharger l'écran de résultats ne le change pas.
 */
export function settleRecord(matchId: string, config: MatchConfig, result: PersonalRecord): RecordOutcome {
  const outcomeKey = `tapout.outcome.${matchId}`;
  try {
    const cached = read(outcomeKey, 'session');
    if (cached) return JSON.parse(cached) as RecordOutcome;
  } catch {
    /* verdict illisible : on le recalcule */
  }

  const previous = getRecord(config);
  const isNew = result.score > 0 && (!previous || result.score > previous.score);
  if (isNew) write(RECORDS_KEY, JSON.stringify({ ...allRecords(), [recordKey(config)]: result }));
  const outcome = { previous, isNew };
  write(outcomeKey, JSON.stringify(outcome), 'session');
  return outcome;
}
