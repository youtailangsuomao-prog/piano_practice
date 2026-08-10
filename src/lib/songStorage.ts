import { Song } from './types';

const STORAGE_KEY = 'piano-practice:songs';

export function loadSongs(): Song[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Song[]) : [];
  } catch {
    return [];
  }
}

export function saveSong(song: Song): Song[] {
  const songs = [...loadSongs(), song];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  return songs;
}

export function deleteSong(id: string): Song[] {
  const songs = loadSongs().filter((s) => s.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(songs));
  return songs;
}
