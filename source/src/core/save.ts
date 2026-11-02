/**
 * Thin storage layer. Browsers can refuse storage (private windows, blocked site data, sandboxed
 * previews), so every call is wrapped and the game falls back to memory for the session.
 */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SAVE_KEY = 'halo-fleet-command/save';

export function createMemoryStore(): KeyValueStore {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** localStorage when it works, otherwise an in-memory store. `persistent` says which one you got. */
export function pickStore(): { store: KeyValueStore; persistent: boolean } {
  try {
    const ls = globalThis.localStorage;
    const probe = `${SAVE_KEY}/probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return { store: ls, persistent: true };
  } catch {
    return { store: createMemoryStore(), persistent: false };
  }
}

export function readSave(store: KeyValueStore): string | null {
  try {
    return store.getItem(SAVE_KEY);
  } catch {
    return null;
  }
}

export function writeSave(store: KeyValueStore, text: string): boolean {
  try {
    store.setItem(SAVE_KEY, text);
    return true;
  } catch {
    return false;
  }
}

export function clearSave(store: KeyValueStore): void {
  try {
    store.removeItem(SAVE_KEY);
  } catch {
    /* nothing to clear */
  }
}
