export type Hand = 'right' | 'left' | 'other';

export interface SongNote {
  id: number;
  midi: number;
  name: string;
  time: number;
  duration: number;
  velocity: number;
  hand: Hand;
}

export interface Song {
  name: string;
  notes: SongNote[];
  duration: number;
}
