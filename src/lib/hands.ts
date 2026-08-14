export interface HandAssignable {
  midi: number;
  time: number;
}

const CHORD_TIME_TOLERANCE = 0.06;
// A gap this big (roughly a fifth or more) between adjacent notes in a chord is treated
// as two separate hands rather than one hand's own wide voicing.
const HAND_SPLIT_GAP_SEMITONES = 7;
const MIDDLE_C = 60;

/**
 * Assign left/right hand to each note using a per-chord heuristic: within the notes
 * played at the same moment, if there's a big enough pitch gap, split there (upper =
 * right hand, lower = left hand); otherwise treat the whole chord as one hand, decided
 * by its pitch relative to middle C. Judging each moment on its own — rather than
 * against one threshold for the whole song — means a song whose melody or bass drifts
 * into a different register partway through doesn't get an entire passage
 * misclassified as a single hand.
 */
export function assignHandsByChord<T extends HandAssignable>(notes: T[]): Map<T, 'left' | 'right'> {
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const chords: T[][] = [];
  for (const note of sorted) {
    const current = chords[chords.length - 1];
    if (current && note.time - current[0].time <= CHORD_TIME_TOLERANCE) {
      current.push(note);
    } else {
      chords.push([note]);
    }
  }

  const hands = new Map<T, 'left' | 'right'>();
  for (const chord of chords) {
    const byPitch = [...chord].sort((a, b) => a.midi - b.midi);
    let splitIndex = -1;
    let biggestGap = 0;
    for (let i = 1; i < byPitch.length; i++) {
      const gap = byPitch[i].midi - byPitch[i - 1].midi;
      if (gap > biggestGap) {
        biggestGap = gap;
        splitIndex = i;
      }
    }

    if (splitIndex !== -1 && biggestGap >= HAND_SPLIT_GAP_SEMITONES) {
      byPitch.forEach((note, i) => hands.set(note, i >= splitIndex ? 'right' : 'left'));
    } else {
      const avgPitch = chord.reduce((sum, n) => sum + n.midi, 0) / chord.length;
      const hand: 'left' | 'right' = avgPitch >= MIDDLE_C ? 'right' : 'left';
      chord.forEach((note) => hands.set(note, hand));
    }
  }

  return hands;
}
