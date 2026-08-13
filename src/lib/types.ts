export interface NoteEvent {
  /** MIDI note number, e.g. 60 = middle C */
  midi: number;
  /** Start time in seconds from the beginning of the song */
  time: number;
  /** Duration in seconds */
  duration: number;
  /** 0-1 */
  velocity: number;
  hand: 'left' | 'right';
}

export interface Song {
  id: string;
  name: string;
  source: 'midi-import' | 'audio-transcription';
  notes: NoteEvent[];
  durationSeconds: number;
  createdAt: number;
  bpm: number;
  beatsPerMeasure: number;
}

export interface PracticeAttempt {
  songId: string;
  timestamp: number;
  notesTotal: number;
  notesCorrect: number;
  accuracy: number;
}
