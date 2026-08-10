export interface PianoNoteEvent {
  midi: number;
  velocity: number;
  on: boolean;
  timestamp: number;
}

export type PianoNoteListener = (event: PianoNoteEvent) => void;

export type PianoInputStatus = 'unsupported' | 'disconnected' | 'connecting' | 'connected' | 'error';

/**
 * Wraps the Web MIDI API to expose note on/off events from any connected
 * MIDI input (electric piano over USB or Bluetooth MIDI).
 */
export class PianoInput {
  private access: MIDIAccess | null = null;
  private listeners = new Set<PianoNoteListener>();
  private boundInputs = new Set<MIDIInput>();

  isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
  }

  async connect(): Promise<string[]> {
    if (!this.isSupported()) {
      throw new Error('このブラウザはWeb MIDI APIに対応していません');
    }
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.bindAllInputs();
    this.access.onstatechange = () => this.bindAllInputs();
    return this.deviceNames();
  }

  deviceNames(): string[] {
    if (!this.access) return [];
    const names: string[] = [];
    this.access.inputs.forEach((input) => names.push(input.name ?? input.id));
    return names;
  }

  onNote(listener: PianoNoteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  disconnect() {
    this.boundInputs.forEach((input) => {
      input.onmidimessage = null;
    });
    this.boundInputs.clear();
    this.access = null;
  }

  private bindAllInputs() {
    if (!this.access) return;
    this.access.inputs.forEach((input) => {
      if (this.boundInputs.has(input)) return;
      input.onmidimessage = (event) => this.handleMessage(event);
      this.boundInputs.add(input);
    });
  }

  private handleMessage(event: MIDIMessageEvent) {
    if (!event.data) return;
    const [statusByte, midi, velocityByte] = event.data;
    const command = statusByte & 0xf0;
    const velocity = velocityByte / 127;

    if (command === 0x90 && velocity > 0) {
      this.emit({ midi, velocity, on: true, timestamp: performance.now() / 1000 });
    } else if (command === 0x80 || (command === 0x90 && velocity === 0)) {
      this.emit({ midi, velocity: 0, on: false, timestamp: performance.now() / 1000 });
    }
  }

  private emit(event: PianoNoteEvent) {
    this.listeners.forEach((listener) => listener(event));
  }
}
