import {
  FORMATS,
  FORMAT_INFO,
  GAME_LEVELS,
  GAME_LEVEL_LABEL,
  LEVEL_LABEL,
  roundLevels,
  type GameLevel,
  type MatchConfig,
} from '../../shared/protocol';

export const LEVEL_WHO: Record<GameLevel, string> = {
  facile: 'Tu as vu quelques combats : les grands noms, les règles de base.',
  moyen: 'Fan régulier : champions marquants, événements connus.',
  difficile: 'Fan assidu : dates, résultats précis, records.',
  expert: "Encyclopédie de l'UFC : histoire ancienne, stats pointues.",
  mix: 'Pour tout le monde : la difficulté monte à chaque round.',
};

/** « Combat classique · R1 Facile · R2 Moyen · R3 Difficile » */
export function describeFight(config: MatchConfig): string {
  const ladder = roundLevels(config)
    .map((l, i) => `R${i + 1} ${LEVEL_LABEL[l]}`)
    .join(' · ');
  return `${FORMAT_INFO[config.format].label} · ${ladder}`;
}

interface Props {
  value: MatchConfig;
  onChange: (config: MatchConfig) => void;
}

/** Choix du niveau et du format d'un combat (solo, ou hôte d'un salon). */
export function FightPicker({ value, onChange }: Props) {
  return (
    <>
      <section className="config-section" aria-labelledby="lvl">
        <h2 id="lvl" className="label">
          Niveau
        </h2>
        <div className="choice-grid choice-levels" role="radiogroup" aria-labelledby="lvl">
          {GAME_LEVELS.map((level) => (
            <button
              key={level}
              type="button"
              role="radio"
              aria-checked={value.level === level}
              className={`choice ${value.level === level ? 'is-on' : ''} ${level === 'mix' ? 'choice-mix' : ''}`}
              onClick={() => onChange({ ...value, level })}
            >
              <span className="display choice-name">{GAME_LEVEL_LABEL[level]}</span>
              <span className="choice-text">{LEVEL_WHO[level]}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="config-section" aria-labelledby="fmt">
        <h2 id="fmt" className="label">
          Format
        </h2>
        <div className="choice-grid choice-formats" role="radiogroup" aria-labelledby="fmt">
          {FORMATS.map((format) => {
            const f = FORMAT_INFO[format];
            return (
              <button
                key={format}
                type="button"
                role="radio"
                aria-checked={value.format === format}
                className={`choice choice-format ${value.format === format ? 'is-on' : ''}`}
                onClick={() => onChange({ ...value, format })}
              >
                <span className="display choice-big">
                  {f.rounds}×{f.perRound}
                </span>
                <span>
                  <span className="display choice-name">{f.label}</span>
                  <span className="choice-text">
                    {f.rounds} rounds de {f.perRound} questions · {f.rounds * f.perRound} questions
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
