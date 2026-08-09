import { Midi } from '@tonejs/midi';
import type { Hand, Song, SongNote } from '../types';

export async function parseMidiFile(data: ArrayBuffer, name: string): Promise<Song> {
  const midi = new Midi(data);
  const notes: SongNote[] = [];
  let id = 0;

  const tracksWithNotes = midi.tracks.filter((t) => t.notes.length > 0);

  tracksWithNotes.forEach((track, trackIndex) => {
    const hand: Hand = trackIndex === 0 ? 'right' : trackIndex === 1 ? 'left' : 'other';
    track.notes.forEach((n) => {
      notes.push({
        id: id++,
        midi: n.midi,
        name: n.name,
        time: n.time,
        duration: Math.max(n.duration, 0.05),
        velocity: n.velocity,
        hand,
      });
    });
  });

  notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
  const duration = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);

  return { name, notes, duration };
}

export async function loadSampleSong(url: string, name: string): Promise<Song> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`サンプル曲の読み込みに失敗しました: ${url}`);
  const buffer = await res.arrayBuffer();
  return parseMidiFile(buffer, name);
}
