/** 12 345 → « 12 345 » */
export const fmt = (n: number) => n.toLocaleString('fr-FR');

/** 3 456 ms → « 3,5 s » */
export const secs = (ms: number | null) => (ms === null ? '—' : `${(ms / 1000).toFixed(1).replace('.', ',')} s`);
