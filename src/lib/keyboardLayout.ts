const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export const WHITE_KEY_WIDTH = 32;
export const BLACK_KEY_WIDTH = 20;
export const WHITE_KEY_HEIGHT = 260;
export const BLACK_KEY_HEIGHT = 164;

export function isWhiteKey(midi: number): boolean {
  return WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

export interface KeyLayout {
  midi: number;
  isWhite: boolean;
  x: number;
}

/** Lay out white/black keys left-to-right for the given MIDI note range. */
export function layoutKeys(lowMidi: number, highMidi: number): { keys: KeyLayout[]; width: number } {
  const keys: KeyLayout[] = [];
  let whiteCount = 0;
  for (let midi = lowMidi; midi <= highMidi; midi++) {
    if (isWhiteKey(midi)) {
      keys.push({ midi, isWhite: true, x: whiteCount * WHITE_KEY_WIDTH });
      whiteCount += 1;
    } else {
      keys.push({ midi, isWhite: false, x: whiteCount * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 });
    }
  }
  return { keys, width: whiteCount * WHITE_KEY_WIDTH };
}

/** x-position (and width) of a single key, for aligning other UI (e.g. falling notes) to the keyboard. */
export function keyPosition(midi: number, lowMidi: number, highMidi: number): { x: number; width: number } {
  const { keys } = layoutKeys(lowMidi, highMidi);
  const key = keys.find((k) => k.midi === midi);
  if (!key) return { x: 0, width: WHITE_KEY_WIDTH };
  return { x: key.x, width: key.isWhite ? WHITE_KEY_WIDTH : BLACK_KEY_WIDTH };
}
