// Generates a couple of public-domain / original sample .mid files for first-run testing.
// Run with: node scripts/generate-sample-midis.mjs
import pkg from '@tonejs/midi';
const { Midi } = pkg;
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = join(__dirname, '..', 'public', 'songs');

const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
function midi(letter, octave) {
  return 12 * (octave + 1) + NOTE[letter];
}

function buildSong({ bpm, tracks }) {
  const midiFile = new Midi();
  midiFile.header.setTempo(bpm);
  const beatSec = 60 / bpm;

  for (const events of tracks) {
    const track = midiFile.addTrack();
    let t = 0;
    for (const [pitch, beats] of events) {
      const dur = beats * beatSec;
      if (pitch !== null) {
        track.addNote({ midi: pitch, time: t, duration: dur * 0.95, velocity: 0.8 });
      }
      t += dur;
    }
  }
  return midiFile;
}

// --- きらきら星 (Twinkle Twinkle Little Star / "Ah! vous dirai-je, maman") ---
// Traditional French folk melody, public domain.
const C4 = midi('C', 4);
const D4 = midi('D', 4);
const E4 = midi('E', 4);
const F4 = midi('F', 4);
const G4 = midi('G', 4);
const A4 = midi('A', 4);

const melody = [
  [C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2],
  [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2],
  [G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2],
  [G4, 1], [G4, 1], [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 2],
  [C4, 1], [C4, 1], [G4, 1], [G4, 1], [A4, 1], [A4, 1], [G4, 2],
  [F4, 1], [F4, 1], [E4, 1], [E4, 1], [D4, 1], [D4, 1], [C4, 2],
];

const C3 = midi('C', 3);
const F3 = midi('F', 3);
const G3 = midi('G', 3);
const chordFor = (root, beats) => [root, beats];
const leftHand = [
  chordFor(C3, 4), chordFor(C3, 4), chordFor(F3, 4), chordFor(C3, 4),
  chordFor(G3, 4), chordFor(C3, 4), chordFor(F3, 4), chordFor(C3, 4),
  chordFor(G3, 4), chordFor(C3, 4), chordFor(F3, 4), chordFor(C3, 4),
];

const twinkle = buildSong({ bpm: 100, tracks: [melody, leftHand] });
writeFileSync(join(outDir, 'twinkle-twinkle.mid'), Buffer.from(twinkle.toArray()));

// --- ドレミの練習 (original simple 5-finger warm-up exercise, right hand only) ---
const scaleMelody = [
  [C4, 1], [D4, 1], [E4, 1], [F4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1], [C4, 2],
  [C4, 1], [D4, 1], [E4, 1], [F4, 1], [G4, 1], [F4, 1], [E4, 1], [D4, 1], [C4, 2],
];
const scaleSong = buildSong({ bpm: 90, tracks: [scaleMelody] });
writeFileSync(join(outDir, 'scale-exercise.mid'), Buffer.from(scaleSong.toArray()));

console.log('Generated sample MIDI files in', outDir);
