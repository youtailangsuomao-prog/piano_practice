import { NoteEvent } from './types';

export interface Chord {
  time: number;
  notes: NoteEvent[];
}

/** Group notes that start within `toleranceSeconds` of each other into a single chord/step. */
export function groupNotesIntoChords(notes: NoteEvent[], toleranceSeconds = 0.06): Chord[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const chords: Chord[] = [];

  for (const note of sorted) {
    const current = chords[chords.length - 1];
    if (current && note.time - current.time <= toleranceSeconds) {
      current.notes.push(note);
    } else {
      chords.push({ time: note.time, notes: [note] });
    }
  }

  return chords;
}
