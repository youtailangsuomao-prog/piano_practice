import { NoteEvent } from './types';

let audioCtx: AudioContext | null = null;
let masterBus: GainNode | null = null;
let reverbSend: GainNode | null = null;

function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** A short synthetic impulse response, so we get a sense of room/space with no external assets. */
function createReverbImpulse(ctx: AudioContext): AudioBuffer {
  const durationSeconds = 2.2;
  const decay = 2.5;
  const length = Math.floor(ctx.sampleRate * durationSeconds);
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
    }
  }
  return impulse;
}

/** Lazily builds the shared output bus: dry path + a reverb send/return, both to destination. */
function getMasterBus(ctx: AudioContext): { dry: GainNode; wet: GainNode } {
  if (masterBus && reverbSend) return { dry: masterBus, wet: reverbSend };

  const out = ctx.createGain();
  out.gain.value = 0.9;
  out.connect(ctx.destination);

  const convolver = ctx.createConvolver();
  convolver.buffer = createReverbImpulse(ctx);
  const wetGain = ctx.createGain();
  wetGain.gain.value = 0.32;
  convolver.connect(wetGain);
  wetGain.connect(out);

  const send = ctx.createGain();
  send.gain.value = 1; // each voice sets its own send amount before connecting here
  send.connect(convolver);

  masterBus = out;
  reverbSend = send;
  return { dry: out, wet: send };
}

function getAudioContext(): AudioContext {
  if (!audioCtx) audioCtx = new AudioContext();
  return audioCtx;
}

export interface PlaybackNoteEvent {
  midi: number;
  hand: 'left' | 'right';
  on: boolean;
}

let activeOscillators: OscillatorNode[] = [];
let activeTimers: ReturnType<typeof setTimeout>[] = [];

export function stopPlayback() {
  activeOscillators.forEach((osc) => {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
  });
  activeOscillators = [];
  activeTimers.forEach((timer) => clearTimeout(timer));
  activeTimers = [];
}

// A handful of harmonics with piano-ish relative levels and a touch of inharmonicity
// (real piano strings run slightly sharp on the upper partials), each with its own
// decay so the tone darkens naturally as a note rings out.
const HARMONICS = [
  { mult: 1, amp: 1, decayMul: 1 },
  { mult: 2, amp: 0.5, decayMul: 0.75 },
  { mult: 3.01, amp: 0.27, decayMul: 0.55 },
  { mult: 4.02, amp: 0.15, decayMul: 0.4 },
  { mult: 6.03, amp: 0.07, decayMul: 0.28 },
];

function scheduleNote(ctx: AudioContext, note: NoteEvent, startAt: number, noteDuration: number) {
  const { dry, wet } = getMasterBus(ctx);
  const freq = midiToFrequency(note.midi);

  let voiceOut: AudioNode = dry;
  if (typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.value = note.hand === 'left' ? -0.22 : 0.22;
    panner.connect(dry);
    const wetSend = ctx.createGain();
    wetSend.gain.value = 0.28;
    panner.connect(wetSend);
    wetSend.connect(wet);
    voiceOut = panner;
  }

  // Lower notes physically ring longer on a real piano; scale the decay accordingly.
  const registerFactor = 1.6 + (1 - Math.min(1, (note.midi - 21) / 87)) * 1.8;
  const sustain = Math.max(noteDuration, 0.2) * registerFactor;
  const peak = Math.min(0.22, 0.09 + note.velocity * 0.16);

  HARMONICS.forEach(({ mult, amp, decayMul }) => {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq * mult;

    const gain = ctx.createGain();
    const harmonicPeak = peak * amp;
    const decayTime = sustain * decayMul;
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(harmonicPeak, startAt + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0006, startAt + decayTime);

    osc.connect(gain);
    gain.connect(voiceOut);
    osc.start(startAt);
    osc.stop(startAt + decayTime + 0.05);
    activeOscillators.push(osc);
  });
}

/**
 * Play a group of notes through a small additive piano-ish synth (a few harmonics per
 * note, hand panned left/right, a touch of reverb for atmosphere), timed relative to
 * `groupStartTime` (so a phrase can be played starting from t=0 of the playback).
 * `onEvent` (optional) fires as each note starts/stops sounding, in real wall-clock
 * time, so UI (e.g. the keyboard) can be lit up in sync with the audio.
 * Resolves once the last note has finished ringing out.
 */
export async function playNotes(
  notes: NoteEvent[],
  groupStartTime: number,
  onEvent?: (event: PlaybackNoteEvent) => void,
): Promise<void> {
  stopPlayback();
  if (notes.length === 0) return;

  const ctx = getAudioContext();
  if (ctx.state !== 'running') {
    await ctx.resume();
  }
  const startDelay = 0.05;
  const now = ctx.currentTime + startDelay;
  let latestEnd = 0;

  notes.forEach((note) => {
    const relativeStart = Math.max(0, note.time - groupStartTime);
    const startAt = now + relativeStart;
    const duration = Math.max(note.duration, 0.15);
    const endAt = startAt + duration;
    latestEnd = Math.max(latestEnd, endAt - now);

    scheduleNote(ctx, note, startAt, duration);

    if (onEvent) {
      const onDelayMs = Math.max(0, (startAt - ctx.currentTime) * 1000);
      const offDelayMs = Math.max(0, (endAt - ctx.currentTime) * 1000);
      activeTimers.push(setTimeout(() => onEvent({ midi: note.midi, hand: note.hand, on: true }), onDelayMs));
      activeTimers.push(setTimeout(() => onEvent({ midi: note.midi, hand: note.hand, on: false }), offDelayMs));
    }
  });

  return new Promise((resolve) => {
    setTimeout(resolve, (latestEnd + startDelay + 0.1) * 1000);
  });
}
