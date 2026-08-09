export interface SampleSongInfo {
  id: string;
  name: string;
  url: string;
}

export const SAMPLE_SONGS: SampleSongInfo[] = [
  { id: 'twinkle', name: 'きらきら星(両手)', url: '/songs/twinkle-twinkle.mid' },
  { id: 'scale', name: 'ドレミの練習(かんたん)', url: '/songs/scale-exercise.mid' },
];
