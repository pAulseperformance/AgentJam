import type { Patch } from '@/shared/music/patch';

/**
 * THE PRESETS A PERSON MAKES.
 *
 * Twelve factory patches are a starting point and not a library: the moment a cutoff and an envelope are
 * worth keeping, a synth needs somewhere to put them. Saved patches live in localStorage, ship as JSON,
 * and import through the same validation the server uses, so a saved or pasted patch cannot be a voice the
 * engine refuses.
 */
const KEY = 'agentjam:patches:v1';

export interface SavedPatch {
  name: string;
  patch: Patch;
  savedAt: number;
}

function read(): SavedPatch[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedPatch[]).slice(0, 50) : [];
  } catch {
    // A corrupt store is an empty store, not a crash: the panel still opens.
    return [];
  }
}

function write(list: SavedPatch[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, 50)));
  } catch {
    // storage full or blocked: the panel keeps working from memory for this session
  }
}

export function savedPatches(): SavedPatch[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

/** Save under a name, replacing a patch of the same name rather than piling up duplicates. */
export function savePatch(name: string, patch: Patch): SavedPatch[] {
  const list = read().filter(entry => entry.name !== name);
  list.push({ name, patch, savedAt: Date.now() });
  write(list);
  return savedPatches();
}

export function deletePatch(name: string): SavedPatch[] {
  write(read().filter(entry => entry.name !== name));
  return savedPatches();
}

/** The whole library as text, for a person who wants to keep it somewhere else. */
export function exportPatches(): string {
  return JSON.stringify(read(), null, 2);
}
