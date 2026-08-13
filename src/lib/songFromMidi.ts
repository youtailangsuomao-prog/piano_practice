import { Midi } from '@tonejs/midi';
import { NoteEvent, Song } from './types';
import { medianPitch } from './hands';

interface MidiNote {
  midi: number;
  time: number;
  duration: number;
  velocity: number;
}

function toNoteEvent(note: MidiNote, hand: 'left' | 'right'): NoteEvent {
  return { midi: note.midi, time: note.time, duration: note.duration, velocity: note.velocity, hand };
}

/**
 * Guess which hand plays each note. Piano MIDI files are usually exported as two
 * tracks (treble/right hand, bass/left hand); when that structure is available we
 * use it, otherwise we fall back to splitting by pitch around the track's median note.
 */
function assignHands(noteTracks: { notes: MidiNote[] }[]): NoteEvent[] {
  if (noteTracks.length >= 2) {
    const withAvgPitch = noteTracks.map((track) => ({
      track,
      avgPitch: track.notes.reduce((sum, n) => sum + n.midi, 0) / track.notes.length,
    }));
    withAvgPitch.sort((a, b) => b.avgPitch - a.avgPitch);
    const [rightTrack, ...leftTracks] = withAvgPitch;
    return [
      ...rightTrack.track.notes.map((n) => toNoteEvent(n, 'right')),
      ...leftTracks.flatMap(({ track }) => track.notes.map((n) => toNoteEvent(n, 'left'))),
    ];
  }

  const allNotes = noteTracks.flatMap((track) => track.notes);
  const threshold = medianPitch(allNotes.map((n) => n.midi));
  return allNotes.map((n) => toNoteEvent(n, n.midi >= threshold ? 'right' : 'left'));
}

/** Parse an uploaded .mid/.midi file into the app's internal Song format. */
export async function songFromMidiFile(file: File): Promise<Song> {
  const arrayBuffer = await file.arrayBuffer();
  const midi = new Midi(arrayBuffer);

  const noteTracks = midi.tracks
    // Channel 9 (10 in 1-indexed MIDI) is the standard percussion channel; skip it.
    .filter((track) => track.channel !== 9 && track.notes.length > 0);

  const notes = assignHands(noteTracks).sort((a, b) => a.time - b.time);

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
