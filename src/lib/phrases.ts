import { NoteEvent, Song } from './types';

export interface Phrase {
  index: number;
  startTime: number;
  endTime: number;
  notes: NoteEvent[];
}

/** Split a song into fixed-length phrases (default: 4 measures each) for loop practice. */
export function buildPhrases(song: Song, measuresPerPhrase = 4): Phrase[] {
  const bpm = song.bpm > 0 ? song.bpm : 120;
  const beatsPerMeasure = song.beatsPerMeasure > 0 ? song.beatsPerMeasure : 4;
  const secondsPerMeasure = (60 / bpm) * beatsPerMeasure;
  const phraseLength = secondsPerMeasure * measuresPerPhrase;

  const phrases: Phrase[] = [];
  let start = 0;
  let safety = 0;

  while (start < song.durationSeconds && safety < 2000) {
    const end = start + phraseLength;
    const notes = song.notes.filter((n) => n.time >= start && n.time < end);
    if (notes.length > 0) {
      phrases.push({ index: phrases.length, startTime: start, endTime: end, notes });
    }
    start = end;
    safety += 1;
  }

  return phrases;
}
