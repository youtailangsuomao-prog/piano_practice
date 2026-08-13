import { SongProgress } from './types';

const STORAGE_KEY = 'piano-practice:song-progress';

function loadAll(): Record<string, SongProgress> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, SongProgress>) : {};
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, SongProgress>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
}

export function loadSongProgress(songId: string): SongProgress | null {
  return loadAll()[songId] ?? null;
}

export function saveSongProgress(progress: SongProgress) {
  const all = loadAll();
  all[progress.songId] = progress;
  saveAll(all);
}

export function clearSongProgress(songId: string) {
  const all = loadAll();
  delete all[songId];
  saveAll(all);
}
