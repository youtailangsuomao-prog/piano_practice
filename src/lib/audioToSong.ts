import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
} from '@spotify/basic-pitch';
import { NoteEvent, Song } from './types';
import { assignHandsByChord } from './hands';

const MODEL_URL = `${import.meta.env.BASE_URL}basic-pitch-model/model.json`;
const BASIC_PITCH_SAMPLE_RATE = 22050;

let basicPitch: BasicPitch | null = null;
function getBasicPitch(): BasicPitch {
  if (!basicPitch) basicPitch = new BasicPitch(MODEL_URL);
  return basicPitch;
}

/** Decode an audio file and resample/downmix it to mono 22.05kHz, as required by basic-pitch. */
async function decodeToMono22k(file: File): Promise<Float32Array> {
  const arrayBuffer = await file.arrayBuffer();
  const decodeCtx = new AudioContext();
  const decoded = await decodeCtx.decodeAudioData(arrayBuffer);
  await decodeCtx.close();

  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * BASIC_PITCH_SAMPLE_RATE),
    BASIC_PITCH_SAMPLE_RATE,
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start();
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Transcribe an uploaded audio file (mp3/wav/ogg/flac) into the app's internal
 * Song format using Spotify's basic-pitch polyphonic transcription model.
 */
export async function songFromAudioFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Song> {
  const monoAudio = await decodeToMono22k(file);

  const frames: number[][] = [];
  const onsets: number[][] = [];
  const contours: number[][] = [];

  await getBasicPitch().evaluateModel(
    monoAudio,
    (f, o, c) => {
      frames.push(...f);
      onsets.push(...o);
      contours.push(...c);
    },
    (fraction) => onProgress?.(fraction),
  );

  const noteEvents = noteFramesToTime(
    addPitchBendsToNoteEvents(contours, outputToNotesPoly(frames, onsets, 0.25, 0.25, 5)),
  );

  const rawNotes = noteEvents.map((n) => ({
    midi: n.pitchMidi,
    time: n.startTimeSeconds,
    duration: n.durationSeconds,
    velocity: n.amplitude,
  }));
  const handByNote = assignHandsByChord(rawNotes);
  const notes: NoteEvent[] = rawNotes
    .map((n): NoteEvent => ({ ...n, hand: handByNote.get(n) ?? 'right' }))
    .sort((a, b) => a.time - b.time);

  const durationSeconds = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);

  return {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    source: 'audio-transcription',
    notes,
    durationSeconds,
    createdAt: Date.now(),
    // basic-pitch doesn't detect tempo/time signature, so we assume a common default
    // for phrase segmentation (4/4 at 120bpm ≈ 4 measures / 8 seconds).
    bpm: 120,
    beatsPerMeasure: 4,
  };
}
