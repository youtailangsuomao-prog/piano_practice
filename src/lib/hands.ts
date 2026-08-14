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

/**
 * MIDI itself has no dedicated "hand" field — only note/time/track data. But a piano
 * part exported from notation software (as two staves: treble/right hand, bass/left
 * hand) often comes out as exactly two tracks that are genuinely, consistently split
 * by register. When that's true, the track assignment is real ground truth and is more
 * reliable than any per-chord guess (it correctly keeps e.g. a same-hand melodic run
 * together even when it dips into the other hand's usual register). This checks
 * whether two tracks actually look like that: at every moment both play together, is
 * the "higher" track's note actually higher than the "lower" track's note?
 */
export function isCleanTwoHandSplit<T extends HandAssignable>(trackA: T[], trackB: T[]): boolean {
  if (trackA.length === 0 || trackB.length === 0) return true;
  const higherIsA = average(trackA.map((n) => n.midi)) >= average(trackB.map((n) => n.midi));
  const higherTrack = higherIsA ? trackA : trackB;
  const lowerTrack = higherIsA ? trackB : trackA;

  const combined = [
    ...higherTrack.map((n) => ({ midi: n.midi, time: n.time, side: 'higher' as const })),
    ...lowerTrack.map((n) => ({ midi: n.midi, time: n.time, side: 'lower' as const })),
  ].sort((a, b) => a.time - b.time);

  let comparableMoments = 0;
  let crossings = 0;
  let i = 0;
  while (i < combined.length) {
    let j = i + 1;
    while (j < combined.length && combined[j].time - combined[i].time <= CHORD_TIME_TOLERANCE) j++;
    const group = combined.slice(i, j);
    const highs = group.filter((n) => n.side === 'higher').map((n) => n.midi);
    const lows = group.filter((n) => n.side === 'lower').map((n) => n.midi);
    if (highs.length > 0 && lows.length > 0) {
      comparableMoments += 1;
      if (Math.min(...highs) < Math.max(...lows)) crossings += 1;
    }
    i = j;
  }

  if (comparableMoments === 0) return true;
  return crossings / comparableMoments <= 0.15;
}

/** Assign every note in one track to the right hand and the other to the left hand. */
export function assignHandsByTrackOrder<T extends HandAssignable>(trackA: T[], trackB: T[]): Map<T, 'left' | 'right'> {
  const higherIsA = average(trackA.map((n) => n.midi)) >= average(trackB.map((n) => n.midi));
  const [rightTrack, leftTrack] = higherIsA ? [trackA, trackB] : [trackB, trackA];
  const hands = new Map<T, 'left' | 'right'>();
  rightTrack.forEach((note) => hands.set(note, 'right'));
  leftTrack.forEach((note) => hands.set(note, 'left'));
  return hands;
}
