import type { HandFilter } from '../engine/practiceEngine';
import type { Song, SongNote } from '../types';

export function filterNotesByHand(song: Song | null, handFilter: HandFilter): SongNote[] {
  if (!song) return [];
  if (handFilter === 'both') return song.notes;
  return song.notes.filter((n) => n.hand === handFilter || n.hand === 'other');
}
