export interface HandAssignable {
  midi: number;
  time: number;
}

const CHORD_TIME_TOLERANCE = 0.06;
// A gap this big (roughly a fifth or more) between adjacent notes in a chord is treated
// as two separate hands rather than one hand's own wide voicing.
const HAND_SPLIT_GAP_SEMITONES = 7;
const MIDDLE_C = 60;

function average(midis: number[]): number {
  return midis.reduce((sum, m) => sum + m, 0) / midis.length;
}

/**
 * Assign left/right hand to each note using a per-chord heuristic: within the notes
 * played at the same moment, if there's a big enough pitch gap, split there (upper =
 * right hand, lower = left hand). Judging each moment on its own — rather than against
 * one threshold for the whole song — means a song whose melody or bass drifts into a
 * different register partway through doesn't get an entire passage misclassified.
 *
 * When a chord has no such gap (a single note, or a tight one-hand voicing), there's no
 * local evidence to split on. Rather than a fixed cutoff like middle C — which
 * misclassifies any passage where one hand plays consistently on the "wrong" side of it
 * (e.g. a melody dipping below middle C, or a left-hand voicing reaching above it) — we
 * track each hand's recently-seen pitch center and assign the ambiguous chord to
 * whichever hand it's closer to, so an isolated note continuing a hand's established
 * register stays with that hand.
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
  let lastRightPitch = MIDDLE_C + 12;
  let lastLeftPitch = MIDDLE_C - 12;

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
      const rightNotes = byPitch.slice(splitIndex);
      const leftNotes = byPitch.slice(0, splitIndex);
      rightNotes.forEach((note) => hands.set(note, 'right'));
      leftNotes.forEach((note) => hands.set(note, 'left'));
      lastRightPitch = average(rightNotes.map((n) => n.midi));
      lastLeftPitch = average(leftNotes.map((n) => n.midi));
    } else {
      const avgPitch = average(chord.map((n) => n.midi));
      const distRight = Math.abs(avgPitch - lastRightPitch);
      const distLeft = Math.abs(avgPitch - lastLeftPitch);
      const hand: 'left' | 'right' = distRight <= distLeft ? 'right' : 'left';
      chord.forEach((note) => hands.set(note, hand));
      if (hand === 'right') lastRightPitch = avgPitch;
      else lastLeftPitch = avgPitch;
    }
  }

  return hands;
}
