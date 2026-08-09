import { filterNotesByHand } from '../lib/notes';
import { isWebMidiSupported, listInputs, parseMidiMessage, requestMidiAccess, type MidiInputInfo } from '../lib/webMidi';
import type { Song, SongNote } from '../types';

export type PlaybackMode = 'demo' | 'practice';
export type HandFilter = 'both' | 'right' | 'left';
export type NoteStatus = 'hit' | 'missed';
export type MidiConnectionStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';

export interface EngineState {
  song: Song | null;
  mode: PlaybackMode;
  handFilter: HandFilter;
  waitMode: boolean;
  speed: number;
  isPlaying: boolean;
  songTime: number;
  activeNoteIds: Set<number>;
  statuses: Map<number, NoteStatus>;
  wrongFlashKeys: Set<number>;
  pressedKeys: Set<number>;
  score: { hit: number; missed: number; wrong: number };
  midiSupported: boolean;
  midiStatus: MidiConnectionStatus;
  midiError: string | null;
  midiInputs: MidiInputInfo[];
  selectedInputId: string | null;
}

type Listener = () => void;
type ToneModule = typeof import('tone');

const HIT_WINDOW = 0.35;
const MIN_VISUAL_DURATION = 0.15;

function setsEqual(a: Set<number>, b: Set<number>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

class PracticeEngine {
  private state: EngineState;
  private listeners = new Set<Listener>();
  private rafId: number | null = null;
  private lastTs: number | null = null;
  private synth: InstanceType<ToneModule['PolySynth']> | null = null;
  private midiAccess: MIDIAccess | null = null;
  private currentInput: MIDIInput | null = null;
  private wrongFlashTimers = new Map<number, ReturnType<typeof setTimeout>>();

  constructor() {
    this.state = {
      song: null,
      mode: 'demo',
      handFilter: 'both',
      waitMode: true,
      speed: 1,
      isPlaying: false,
      songTime: 0,
      activeNoteIds: new Set(),
      statuses: new Map(),
      wrongFlashKeys: new Set(),
      pressedKeys: new Set(),
      score: { hit: 0, missed: 0, wrong: 0 },
      midiSupported: isWebMidiSupported(),
      midiStatus: isWebMidiSupported() ? 'disconnected' : 'unsupported',
      midiError: null,
      midiInputs: [],
      selectedInputId: null,
    };
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private emit() {
    this.listeners.forEach((fn) => fn());
  }

  getSnapshot = (): EngineState => this.state;

  private patch(partial: Partial<EngineState>) {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  // ---------- Song / song controls ----------

  loadSong(song: Song) {
    this.pause();
    this.patch({
      song,
      songTime: 0,
      statuses: new Map(),
      activeNoteIds: new Set(),
      wrongFlashKeys: new Set(),
      score: { hit: 0, missed: 0, wrong: 0 },
    });
  }

  setMode(mode: PlaybackMode) {
    this.pause();
    this.patch({ mode });
  }

  setHandFilter(handFilter: HandFilter) {
    this.pause();
    this.patch({ handFilter, songTime: 0, statuses: new Map(), activeNoteIds: new Set(), score: { hit: 0, missed: 0, wrong: 0 } });
  }

  setWaitMode(waitMode: boolean) {
    this.patch({ waitMode });
  }

  setSpeed(speed: number) {
    this.patch({ speed });
  }

  filteredNotes(): SongNote[] {
    return filterNotesByHand(this.state.song, this.state.handFilter);
  }

  async play() {
    if (!this.state.song) return;
    if (this.state.mode === 'demo') await this.ensureSynth();
    this.lastTs = null;
    this.patch({ isPlaying: true });
    this.rafId = requestAnimationFrame(this.tick);
  }

  pause() {
    if (this.rafId != null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
    this.lastTs = null;
    if (this.state.isPlaying) this.patch({ isPlaying: false });
  }

  restart() {
    this.pause();
    this.patch({
      songTime: 0,
      statuses: new Map(),
      activeNoteIds: new Set(),
      wrongFlashKeys: new Set(),
      score: { hit: 0, missed: 0, wrong: 0 },
    });
  }

  private async ensureSynth() {
    if (this.synth) return;
    const Tone = await import('tone');
    await Tone.start();
    this.synth = new Tone.PolySynth(Tone.Synth, {
      envelope: { attack: 0.008, decay: 0.12, sustain: 0.25, release: 0.35 },
    }).toDestination();
  }

  private tick = (ts: number) => {
    if (!this.state.isPlaying) return;
    if (this.lastTs == null) this.lastTs = ts;
    const dt = Math.min((ts - this.lastTs) / 1000, 0.1);
    this.lastTs = ts;
    this.advance(dt);
    if (this.state.isPlaying) this.rafId = requestAnimationFrame(this.tick);
  };

  private advance(dt: number) {
    const { song, mode, waitMode, speed } = this.state;
    if (!song) return;
    const notes = this.filteredNotes();

    if (mode === 'practice' && waitMode) {
      const nextUnresolved = notes.find((n) => !this.state.statuses.has(n.id));
      if (nextUnresolved && this.state.songTime >= nextUnresolved.time) {
        this.updateActiveNotes(notes);
        return;
      }
    }

    const prevTime = this.state.songTime;
    let newTime = prevTime + dt * speed;
    let finished = false;
    if (newTime >= song.duration + 1.2) {
      newTime = song.duration + 1.2;
      finished = true;
    }
    this.patch({ songTime: newTime });

    if (mode === 'demo') this.playDueNotes(notes, prevTime, newTime);
    if (mode === 'practice' && !waitMode) this.markPassedAsMissed(notes, newTime);

    this.updateActiveNotes(notes);
    if (finished) this.pause();
  }

  private playDueNotes(notes: SongNote[], prevTime: number, newTime: number) {
    if (!this.synth) return;
    for (const n of notes) {
      if (n.time >= prevTime && n.time < newTime) {
        this.synth.triggerAttackRelease(n.name, Math.max(n.duration, 0.05));
      }
    }
  }

  private markPassedAsMissed(notes: SongNote[], newTime: number) {
    let changed = false;
    const statuses = new Map(this.state.statuses);
    let missed = this.state.score.missed;
    for (const n of notes) {
      if (statuses.has(n.id)) continue;
      if (n.time + HIT_WINDOW < newTime) {
        statuses.set(n.id, 'missed');
        missed++;
        changed = true;
      }
    }
    if (changed) {
      this.patch({ statuses, score: { ...this.state.score, missed } });
    }
  }

  private updateActiveNotes(notes: SongNote[]) {
    const t = this.state.songTime;
    const next = new Set<number>();
    for (const n of notes) {
      const dur = Math.max(n.duration, MIN_VISUAL_DURATION);
      if (t >= n.time && t <= n.time + dur) next.add(n.id);
    }
    if (!setsEqual(next, this.state.activeNoteIds)) {
      this.patch({ activeNoteIds: next });
    }
  }

  // ---------- Real-time input (from a real MIDI keyboard, or on-screen clicks) ----------

  handleNoteOn(midi: number, _velocity: number) {
    const pressed = new Set(this.state.pressedKeys);
    pressed.add(midi);
    this.patch({ pressedKeys: pressed });

    if (this.state.mode !== 'practice' || !this.state.song) return;
    const notes = this.filteredNotes();
    const songTime = this.state.songTime;

    let best: SongNote | null = null;
    let bestDelta = Infinity;
    for (const n of notes) {
      if (n.midi !== midi) continue;
      if (this.state.statuses.has(n.id)) continue;
      const delta = Math.abs(n.time - songTime);
      if (delta <= HIT_WINDOW && delta < bestDelta) {
        best = n;
        bestDelta = delta;
      }
    }

    if (best) {
      const statuses = new Map(this.state.statuses);
      statuses.set(best.id, 'hit');
      this.patch({ statuses, score: { ...this.state.score, hit: this.state.score.hit + 1 } });
    } else {
      const wrong = new Set(this.state.wrongFlashKeys);
      wrong.add(midi);
      this.patch({ wrongFlashKeys: wrong, score: { ...this.state.score, wrong: this.state.score.wrong + 1 } });
      const existing = this.wrongFlashTimers.get(midi);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        const w = new Set(this.state.wrongFlashKeys);
        w.delete(midi);
        this.patch({ wrongFlashKeys: w });
      }, 260);
      this.wrongFlashTimers.set(midi, timer);
    }
  }

  handleNoteOff(midi: number) {
    const pressed = new Set(this.state.pressedKeys);
    pressed.delete(midi);
    this.patch({ pressedKeys: pressed });
  }

  /** Manual click on the on-screen keyboard: plays a short sound and counts as input in practice mode. */
  async playKeyPreview(midi: number, name: string) {
    if (this.state.mode === 'demo') {
      await this.ensureSynth();
      this.synth?.triggerAttackRelease(name, 0.3);
    }
    this.handleNoteOn(midi, 100);
    setTimeout(() => this.handleNoteOff(midi), 150);
  }

  // ---------- Web MIDI device management ----------

  async connectMidi() {
    if (!this.state.midiSupported) return;
    this.patch({ midiStatus: 'connecting', midiError: null });
    try {
      const access = await requestMidiAccess();
      this.midiAccess = access;
      const inputs = listInputs(access);
      access.onstatechange = () => {
        if (!this.midiAccess) return;
        this.patch({ midiInputs: listInputs(this.midiAccess) });
      };
      this.patch({ midiInputs: inputs, midiStatus: 'connected' });
      if (inputs.length > 0) this.selectMidiInput(inputs[0].id);
    } catch (err) {
      this.patch({ midiStatus: 'error', midiError: err instanceof Error ? err.message : String(err) });
    }
  }

  selectMidiInput(id: string) {
    if (!this.midiAccess) return;
    if (this.currentInput) this.currentInput.onmidimessage = null;
    const input = this.midiAccess.inputs.get(id) ?? null;
    this.currentInput = input;
    if (input) {
      input.onmidimessage = (event: MIDIMessageEvent) => {
        if (!event.data) return;
        const msg = parseMidiMessage(event.data);
        if (msg.type === 'noteon') this.handleNoteOn(msg.note, msg.velocity);
        else if (msg.type === 'noteoff') this.handleNoteOff(msg.note);
      };
    }
    this.patch({ selectedInputId: id });
  }
}

export const engine = new PracticeEngine();
