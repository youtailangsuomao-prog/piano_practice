import { Midi } from '@tonejs/midi';
import { NoteEvent, Song } from './types';
import { assignHandsByChord, assignHandsByTrackOrder, isCleanTwoHandSplit } from './hands';

interface MidiNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

function toNoteEvent(note: MidiNote, hand: 'left' | 'right'): NoteEvent {
  return { midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity, hand };
}

/** Parse an uploaded .mid/.midi file into the app's internal Song format. */
export async function songFromMidiFile(file: File): Promise<Song> {
  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);

  const noteTracks = midi.tracks
    // Channel 9 (10 in 1-indexed MIDI) is the standard percussion channel; skip it.
    .filter((track) => track.channel !== 9 && track.notes.length > 0);

  const allNotes = noteTracks.flatMap((track) => track.notes);

  // MIDI has no dedicated "hand" field, but a piano part exported from notation
  // software as two staves often comes out as exactly two tracks that are genuinely
  // register-separated. When that's verifiably true, trust it as real ground truth;
  // otherwise fall back to guessing per chord.
  const handByNote =
    noteTracks.length === 2 && isCleanTwoHandSplit(noteTracks[0].notes, noteTracks[1].notes)
      ? assignHandsByTrackOrder(noteTracks[0].notes, noteTracks[1].notes)
      : assignHandsByChord(allNotes);

  const notes = allNotes
    .map((n) => toNoteEvent(n, handByNote.get(n) ?? 'right'))
    .sort((a, b) => a.time - b.time);

  const name = midi.name?.trim() || file.name.replace(/\.[^.]+$/, '');
  const bpm = midi.header.tempos[0]?.bpm ?? 120;
  const timeSignature = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const beatsPerMeasure = timeSignature[0] * (4 / timeSignature[1]);

  return {
    id: crypto.randomUUID(),
    name,
    source: 'midi-import',
    notes,
    durationSeconds: midi.duration,
    createdAt: Date.now(),
    bpm,
    beatsPerMeasure,
  };
}
