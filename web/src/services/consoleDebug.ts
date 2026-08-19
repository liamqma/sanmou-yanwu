export interface SanmouDebugSnapshot {
  schemaVersion: 1;
  page: 'game-advisor' | 'team-builder';
  model: {
    catalogVersion: string;
    corpusVersion: string;
    mechanicsVersion: string | null;
    modelType: string;
    featureCount: number;
  };
  [key: string]: unknown;
}

declare global {
  interface Window {
    /** Return the current page's agent-ready debug snapshot as formatted JSON. */
    sanmouDebug?: () => string;
  }
}

/**
 * Install the page-local console debug function. Calling `sanmouDebug()` logs
 * an inspectable object and returns formatted JSON; Chromium users can copy it
 * directly with `copy(sanmouDebug())`.
 */
export function installSanmouDebug(snapshot: SanmouDebugSnapshot): () => void {
  if (typeof window === 'undefined') return () => undefined;

  const debug = (): string => {
    const json = JSON.stringify(snapshot, null, 2);
    console.info('[sanmouDebug] Current recommendation context:', snapshot);
    console.info('[sanmouDebug] Copy for an agent with: copy(sanmouDebug())');
    return json;
  };

  window.sanmouDebug = debug;
  return () => {
    // A newly-mounted route may already have installed its own function.
    if (window.sanmouDebug === debug) delete window.sanmouDebug;
  };
}
