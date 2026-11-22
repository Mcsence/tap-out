/** Évolution de place depuis le round précédent : ▲ 2, ▼ 1, ou =. */
export function RankMove({ rank, prevRank }: { rank: number; prevRank: number | null }) {
  if (prevRank === null) return null;
  const delta = prevRank - rank;
  if (delta > 0)
    return (
      <span className="move move-up" aria-label={`gagne ${delta} place${delta > 1 ? 's' : ''}`}>
        ▲ {delta}
      </span>
    );
  if (delta < 0)
    return (
      <span className="move move-down" aria-label={`perd ${-delta} place${delta < -1 ? 's' : ''}`}>
        ▼ {-delta}
      </span>
    );
  return (
    <span className="move move-same" aria-label="même place">
      =
    </span>
  );
}
