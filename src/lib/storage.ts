// Accès au stockage du navigateur, sans jamais planter s'il est bloqué (navigation privée…).

type Store = 'local' | 'session';

function area(store: Store): Storage | null {
  try {
    return store === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    return null;
  }
}

export function read(key: string, store: Store = 'local'): string | null {
  try {
    return area(store)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function write(key: string, value: string, store: Store = 'local') {
  try {
    area(store)?.setItem(key, value);
  } catch {
    /* stockage indisponible : tant pis, rien d'essentiel */
  }
}
