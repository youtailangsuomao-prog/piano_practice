const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

export function isBlackKey(midi: number): boolean {
  return !WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

export interface KeyLayout {
  midi: number;
  isBlack: boolean;
  x: number;
  width: number;
}

/** Snaps a MIDI note number down/up to the nearest "C" so the keyboard always starts/ends cleanly. */
export function snapRangeToOctaves(minMidi: number, maxMidi: number): [number, number] {
  const lo = minMidi - (((minMidi % 12) + 12) % 12);
  const hiRemainder = ((maxMidi % 12) + 12) % 12;
  const hi = hiRemainder === 0 ? maxMidi : maxMidi + (12 - hiRemainder);
  return [lo, hi];
}

export function computeSongRange(
  notes: { midi: number }[],
  defaultMin = 60,
  defaultMax = 79,
): [number, number] {
  if (notes.length === 0) return snapRangeToOctaves(defaultMin, defaultMax);
  let lo = Infinity;
  let hi = -Infinity;
  for (const n of notes) {
    if (n.midi < lo) lo = n.midi;
    if (n.midi > hi) hi = n.midi;
  }
  lo = Math.min(lo, defaultMin);
  hi = Math.max(hi, defaultMax);
  return snapRangeToOctaves(lo - 1, hi + 1);
}

export function computeKeyboardLayout(
  minMidi: number,
  maxMidi: number,
  widthPx: number,
): { keys: KeyLayout[]; whiteCount: number } {
  const whiteMidis: number[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (!isBlackKey(m)) whiteMidis.push(m);
  }
  const whiteCount = whiteMidis.length;
  const whiteWidth = widthPx / Math.max(whiteCount, 1);
  const blackWidth = whiteWidth * 0.62;

  const whiteX = new Map<number, number>();
  whiteMidis.forEach((m, i) => whiteX.set(m, i * whiteWidth));

  const keys: KeyLayout[] = [];
  for (let m = minMidi; m <= maxMidi; m++) {
    if (!isBlackKey(m)) {
      keys.push({ midi: m, isBlack: false, x: whiteX.get(m)!, width: whiteWidth });
    }
  }
  for (let m = minMidi; m <= maxMidi; m++) {
    if (isBlackKey(m)) {
      const leftWhite = m - 1;
      const lx = whiteX.get(leftWhite);
      if (lx != null) {
        keys.push({ midi: m, isBlack: true, x: lx + whiteWidth - blackWidth / 2, width: blackWidth });
      }
    }
  }
  return { keys, whiteCount };
}

const NOTE_NAMES_JA = ['ド', 'ド#', 'レ', 'レ#', 'ミ', 'ファ', 'ファ#', 'ソ', 'ソ#', 'ラ', 'ラ#', 'シ'];

export function midiToJaName(midi: number): string {
  return NOTE_NAMES_JA[((midi % 12) + 12) % 12];
}
