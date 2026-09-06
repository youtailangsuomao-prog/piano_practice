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

/** Seconds of pre-roll playNotes() always schedules before the first note actually
 * sounds. Exported so callers driving a visual clock in parallel (e.g. the falling
 * notes) can offset their own start reference to match, instead of drifting ahead of
 * the audio by this amount. */
export const PLAYBACK_START_DELAY_SECONDS = 0.05;

interface ActiveVoice {
  osc: OscillatorNode;
  gain: GainNode;
  stopAt: number;
}

let activeVoices: ActiveVoice[] = [];
let activeTimers: ReturnType<typeof setTimeout>[] = [];

/** Drop voices that finished ringing out a while ago. Without this, a long streaming
 * session (a whole-song playthrough) would keep every voice it ever scheduled
 * referenced for the rest of playback — thousands of already-silent oscillators by the
 * second half of a long song — which is enough retained audio-graph state to degrade
 * or cut out the actually-playing voices even though each one is individually inert. */
function pruneFinishedVoices(ctx: AudioContext) {
  const now = ctx.currentTime;
  activeVoices = activeVoices.filter((voice) => voice.stopAt > now);
}

/** How long stopPlayback() ramps a still-ringing voice's gain to silence before actually
 * stopping the oscillator. Cutting an oscillator off immediately (mid-waveform, at
 * whatever amplitude it happens to be at) creates an abrupt discontinuity that's heard
 * as a click/pop; a few milliseconds of fade avoids that. */
const STOP_FADE_SECONDS = 0.015;

export function stopPlayback() {
  activeVoices.forEach(({ osc, gain }) => {
    try {
      const ctx = gain.context;
      const now = ctx.currentTime;
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + STOP_FADE_SECONDS);
      osc.stop(now + STOP_FADE_SECONDS);
    } catch {
      // already stopped
    }
  });
  activeVoices = [];
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
  // Kept modest and capped in absolute terms — a large multiplier applied uniformly
  // (including to very short notes) meant busy passages could have far more notes
  // ringing simultaneously than the piece actually calls for, which is both an
  // unintended "always pedaled" sound and needless load on the audio hardware.
  const registerFactor = 1 + (1 - Math.min(1, (note.midi - 21) / 87)) * 1;
  const sustain = Math.min(Math.max(noteDuration, 0.15) * registerFactor, 3);
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
    const stopAt = startAt + decayTime + 0.05;
    osc.stop(stopAt);
    activeVoices.push({ osc, gain, stopAt });
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
  const startDelay = PLAYBACK_START_DELAY_SECONDS;
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

export interface StreamingPlayback {
  /** Schedule any notes starting within `aheadSeconds` of `songTime` that haven't been
   * scheduled yet. Call this repeatedly (e.g. once per animation frame) as playback
   * advances — scheduling only a near-term window at a time, instead of the whole
   * piece up front, keeps the number of live audio nodes bounded regardless of how
   * long or dense the song is. */
  scheduleAhead(songTime: number, aheadSeconds: number): void;
}

/**
 * Like playNotes(), but for playing a long piece (a whole song, potentially many
 * minutes and thousands of notes) without scheduling everything at once — a single
 * upfront playNotes() call for that much material can mean tens of thousands of
 * simultaneously-created audio nodes, which is enough to overwhelm the audio hardware
 * and produce silence or severe glitching instead of sound. The caller drives
 * scheduleAhead() off its own visual clock (the same one driving the falling notes),
 * so audio scheduling naturally tracks playback position instead of front-loading it.
 */
export async function startStreamingPlayback(notes: NoteEvent[]): Promise<StreamingPlayback> {
  stopPlayback();
  const ctx = getAudioContext();
  if (ctx.state !== 'running') {
    await ctx.resume();
  }
  const sorted = [...notes].sort((a, b) => a.time - b.time);
  const origin = ctx.currentTime + PLAYBACK_START_DELAY_SECONDS;
  let nextIndex = 0;

  return {
    scheduleAhead(songTime, aheadSeconds) {
      pruneFinishedVoices(ctx);
      const horizon = songTime + aheadSeconds;
      while (nextIndex < sorted.length && sorted[nextIndex].time <= horizon) {
        const note = sorted[nextIndex];
        const startAt = origin + note.time;
        const duration = Math.max(note.duration, 0.15);
        scheduleNote(ctx, note, startAt, duration);
        nextIndex += 1;
      }
    },
  };
}
