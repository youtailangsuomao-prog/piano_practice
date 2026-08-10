import { Midi } from '@tonejs/midi';
import { NoteEvent, Song } from './types';

/** Parse an uploaded .mid/.midi file into the app's internal Song format. */
export async function songFromMidiFile(file: File): Promise<Song> {
  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);

  const notes: NoteEvent[] = midi.tracks
    // Channel 9 (10 in 1-indexed MIDI) is the standard percussion channel; skip it.
    .filter((track) => track.channel !== 9)
    .flatMap((track) =>
      track.notes.map((note): NoteEvent => ({
        midi: note.midi,
        time: note.time,
        duration: note.duration,
        velocity: note.velocity,
      })),
    )
    .sort((a, b) => a.time - b.time);

  const name = midi.name?.trim() || file.name.replace(/\.[^.]+$/, '');

  return {
    id: crypto.randomUUID(),
    name,
    source: 'midi-import',
    notes,
    durationSeconds: midi.duration,
    createdAt: Date.now(),
  };
}
