export interface MidiInputInfo {
  id: string;
  name: string;
}

export function isWebMidiSupported(): boolean {
  return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator;
}

export async function requestMidiAccess(): Promise<MIDIAccess> {
  if (!isWebMidiSupported()) {
    throw new Error('このブラウザはWeb MIDI APIに対応していません。Chrome または Edge をお使いください。');
  }
  return navigator.requestMIDIAccess({ sysex: false });
}

export function listInputs(access: MIDIAccess): MidiInputInfo[] {
  return Array.from(access.inputs.values()).map((input) => ({
    id: input.id,
    name: input.name ?? 'MIDIデバイス',
  }));
}

export interface ParsedMidiMessage {
  type: 'noteon' | 'noteoff' | 'other';
  note: number;
  velocity: number;
}

export function parseMidiMessage(data: Uint8Array): ParsedMidiMessage {
  const status = data[0] & 0xf0;
  const note = data[1];
  const velocity = data[2] ?? 0;
  if (status === 0x90 && velocity > 0) return { type: 'noteon', note, velocity };
  if (status === 0x80 || (status === 0x90 && velocity === 0)) return { type: 'noteoff', note, velocity };
  return { type: 'other', note, velocity };
}
