import { NoteEvent } from './types';

let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

let activeOscillators: OscillatorNode[] = [];

export function stopPlayback() {
  activeOscillators.forEach((osc) => {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
  });
  activeOscillators = [];
}

/**
 * Play a group of notes through a simple triangle-wave synth, timed relative to
 * `groupStartTime` (so a phrase can be played starting from t=0 of the playback).
 * Resolves once the last note has finished ringing out.
 */
export function playNotes(notes: NoteEvent[], groupStartTime: number): Promise<void> {
  stopPlayback();
  if (notes.length === 0) return Promise.resolve();

  const ctx = getAudioContext();
  const startDelay = 0.05;
  const now = ctx.currentTime + startDelay;
  let latestEnd = 0;

  notes.forEach((note) => {
    const relativeStart = Math.max(0, note.time - groupStartTime);
    const startAt = now + relativeStart;
    const duration = Math.max(note.duration, 0.15);
    const endAt = startAt + duration;
    latestEnd = Math.max(latestEnd, endAt - now);

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = note.hand === 'left' ? 'sawtooth' : 'triangle';
    osc.frequency.value = midiToFrequency(note.midi);

    const peak = Math.min(0.3, 0.12 + note.velocity * 0.2);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.001, endAt);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(startAt);
    osc.stop(endAt + 0.05);
    activeOscillators.push(osc);
  });

  return new Promise((resolve) => {
    setTimeout(resolve, (latestEnd + startDelay + 0.1) * 1000);
  });
}
