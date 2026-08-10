import { PracticeAttempt } from './types';

const STORAGE_KEY = 'piano-practice:attempts';

export function loadAttempts(): PracticeAttempt[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PracticeAttempt[]) : [];
  } catch {
    return [];
  }
}

export function saveAttempt(attempt: PracticeAttempt): PracticeAttempt[] {
  const attempts = [...loadAttempts(), attempt];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(attempts));
  return attempts;
}

export function attemptsForSong(songId: string): PracticeAttempt[] {
  return loadAttempts()
    .filter((a) => a.songId === songId)
    .sort((a, b) => a.timestamp - b.timestamp);
}
