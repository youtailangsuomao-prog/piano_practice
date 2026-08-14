import { unzipSync } from 'fflate';
import { NoteEvent, Song } from './types';
import { assignHandsByChord, assignHandsByTrackOrder, isCleanTwoHandSplit } from './hands';

const STEP_SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const DEFAULT_VELOCITY = 0.75;
const GRACE_NOTE_DURATION_SECONDS = 0.15;
const MIN_NOTE_DURATION_SECONDS = 0.05;

function directChild(el: Element, tag: string): Element | null {
  for (const child of Array.from(el.children)) {
    if (child.tagName === tag) return child;
  }
  return null;
}

function directChildren(el: Element, tag: string): Element[] {
  return Array.from(el.children).filter((c) => c.tagName === tag);
}

/** Unwraps a compressed .mxl (a ZIP containing the real MusicXML file) into its XML text. */
function extractMxlXmlText(bytes: Uint8Array): string {
  const files = unzipSync(bytes);
  const decoder = new TextDecoder();

  const container = files['META-INF/container.xml'];
  if (container) {
    const containerDoc = new DOMParser().parseFromString(decoder.decode(container), 'application/xml');
    const rootfile = containerDoc.getElementsByTagName('rootfile')[0];
    const fullPath = rootfile?.getAttribute('full-path');
    if (fullPath && files[fullPath]) return decoder.decode(files[fullPath]);
  }

  const fallbackName = Object.keys(files).find(
    (name) => !name.startsWith('META-INF/') && /\.(musicxml|xml)$/i.test(name),
  );
  if (!fallbackName) throw new Error('MXLファイル内に楽譜データが見つかりませんでした。');
  return decoder.decode(files[fallbackName]);
}

function pitchToMidi(pitchEl: Element): number | null {
  const step = directChild(pitchEl, 'step')?.textContent?.trim();
  const octaveText = directChild(pitchEl, 'octave')?.textContent?.trim();
  if (!step || octaveText === undefined) return null;
  const octave = Number(octaveText);
  const alter = Number(directChild(pitchEl, 'alter')?.textContent?.trim() ?? '0');
  const base = STEP_SEMITONES[step];
  if (base === undefined || Number.isNaN(octave) || Number.isNaN(alter)) return null;
  return (octave + 1) * 12 + base + alter;
}

interface RawNote {
  midi: number;
  startSeconds: number;
  durationSeconds: number;
  staff: string;
  tieStart: boolean;
  tieStop: boolean;
  tieKey: string;
}

/** Walks one <part>'s measures in document order, resolving chord/backup/forward/tempo timing
 * into absolute seconds. MusicXML represents time as an integer "divisions per quarter note"
 * cursor that chord notes share, rests/backups move, and tempo converts to real seconds. */
function walkPart(partEl: Element, initialTempo: number): RawNote[] {
  const notes: RawNote[] = [];
  let divisions = 1;
  let tempo = initialTempo;
  let cursorDiv = 0;
  let lastNoteStartDiv = 0;

  for (const measure of directChildren(partEl, 'measure')) {
    for (const el of Array.from(measure.children)) {
      if (el.tagName === 'attributes') {
        const divisionsText = directChild(el, 'divisions')?.textContent?.trim();
        if (divisionsText) {
          const parsed = Number(divisionsText);
          if (parsed > 0) divisions = parsed;
        }
        continue;
      }

      if (el.tagName === 'direction') {
        const soundEl = directChild(el, 'sound');
        const tempoAttr = soundEl?.getAttribute('tempo');
        if (tempoAttr) {
          const parsed = Number(tempoAttr);
          if (parsed > 0) tempo = parsed;
        }
        continue;
      }

      if (el.tagName === 'backup') {
        const dur = Number(directChild(el, 'duration')?.textContent?.trim() ?? '0');
        cursorDiv -= dur;
        continue;
      }

      if (el.tagName === 'forward') {
        const dur = Number(directChild(el, 'duration')?.textContent?.trim() ?? '0');
        cursorDiv += dur;
        continue;
      }

      if (el.tagName !== 'note') continue;

      const isChord = directChild(el, 'chord') !== null;
      const isRest = directChild(el, 'rest') !== null;
      const isGrace = directChild(el, 'grace') !== null;
      const durDiv = isGrace ? 0 : Number(directChild(el, 'duration')?.textContent?.trim() ?? '0');
      const startDiv = isChord ? lastNoteStartDiv : cursorDiv;
      if (!isChord) lastNoteStartDiv = cursorDiv;

      const secondsPerDivision = 60 / tempo / divisions;

      if (!isRest) {
        const pitchEl = directChild(el, 'pitch');
        const midi = pitchEl ? pitchToMidi(pitchEl) : null;
        if (midi !== null) {
          const staff = directChild(el, 'staff')?.textContent?.trim() ?? '1';
          const voice = directChild(el, 'voice')?.textContent?.trim() ?? '1';
          const ties = directChildren(el, 'tie');
          const tieStart = ties.some((t) => t.getAttribute('type') === 'start');
          const tieStop = ties.some((t) => t.getAttribute('type') === 'stop');
          const durationSeconds = isGrace
            ? GRACE_NOTE_DURATION_SECONDS
            : Math.max(durDiv * secondsPerDivision, MIN_NOTE_DURATION_SECONDS);
          notes.push({
            midi,
            startSeconds: startDiv * secondsPerDivision,
            durationSeconds,
            staff,
            tieStart,
            tieStop,
            tieKey: `${staff}:${voice}:${midi}`,
          });
        }
      }

      if (!isChord) cursorDiv += durDiv;
    }
  }

  return notes;
}

/** Merges tie-stop notes into the note they continue, so a tied note plays as one sustained
 * note instead of a phantom second attack the player would otherwise have to re-hit. */
function resolveTies(rawNotes: RawNote[]): RawNote[] {
  const resolved: RawNote[] = [];
  const openTies = new Map<string, RawNote>();

  for (const note of rawNotes) {
    if (note.tieStop) {
      const open = openTies.get(note.tieKey);
      if (open) {
        open.durationSeconds = note.startSeconds + note.durationSeconds - open.startSeconds;
        if (note.tieStart) {
          openTies.set(note.tieKey, open);
        } else {
          openTies.delete(note.tieKey);
        }
        continue;
      }
    }

    resolved.push(note);
    if (note.tieStart) {
      openTies.set(note.tieKey, note);
    }
  }

  return resolved;
}

function toNoteEvent(note: RawNote, hand: 'left' | 'right'): NoteEvent {
  return { midi: note.midi, time: note.startSeconds, duration: note.durationSeconds, velocity: DEFAULT_VELOCITY, hand };
}

function findTitle(doc: Document): string | null {
  const movementTitle = doc.getElementsByTagName('movement-title')[0]?.textContent?.trim();
  if (movementTitle) return movementTitle;
  const workTitle = doc.getElementsByTagName('work-title')[0]?.textContent?.trim();
  if (workTitle) return workTitle;
  return null;
}

/** Parse an uploaded MusicXML (.xml/.musicxml, plain or .mxl-compressed) file into the app's
 * internal Song format, using the score's own staff assignment (1 = right hand, 2 = left hand)
 * as ground truth wherever the file provides it. */
export async function songFromMusicXmlFile(file: File): Promise<Song> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const xmlText = isZip ? extractMxlXmlText(bytes) : new TextDecoder().decode(bytes);

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new Error('MusicXMLファイルの解析に失敗しました。ファイルが壊れている可能性があります。');
  }
  if (doc.getElementsByTagName('score-timewise').length > 0) {
    throw new Error('score-timewise形式のMusicXMLには対応していません。');
  }

  const parts = Array.from(doc.getElementsByTagName('score-partwise')[0]?.children ?? []).filter(
    (el) => el.tagName === 'part',
  );
  if (parts.length === 0) throw new Error('MusicXMLファイルに楽譜パートが見つかりませんでした。');

  const initialTempo = Number(doc.getElementsByTagName('sound')[0]?.getAttribute('tempo') ?? '120') || 120;
  const partNotes = parts.map((part) => resolveTies(walkPart(part, initialTempo)));
  const allRawNotes = partNotes.flat();

  const hasStaffInfo = allRawNotes.length > 0 && allRawNotes.every((n) => n.staff);
  const staffNumbers = new Set(allRawNotes.map((n) => n.staff));

  function assignByChordFallback(): Map<RawNote, 'left' | 'right'> {
    const chordAssignable = allRawNotes.map((n) => ({ midi: n.midi, time: n.startSeconds }));
    const assigned = assignHandsByChord(chordAssignable);
    return new Map(allRawNotes.map((n, i) => [n, assigned.get(chordAssignable[i]) ?? 'right']));
  }

  let handByNote: Map<RawNote, 'left' | 'right'>;
  if (hasStaffInfo && staffNumbers.size > 1) {
    // The score itself marks each note's staff (1 = top/treble = right hand, 2+ = bottom/bass
    // = left hand) — trust it directly rather than guessing.
    handByNote = new Map(allRawNotes.map((n) => [n, n.staff === '1' ? 'right' : 'left']));
  } else if (partNotes.length === 2) {
    const trackA = partNotes[0].map((n) => ({ midi: n.midi, time: n.startSeconds }));
    const trackB = partNotes[1].map((n) => ({ midi: n.midi, time: n.startSeconds }));
    if (isCleanTwoHandSplit(trackA, trackB)) {
      const assigned = assignHandsByTrackOrder(trackA, trackB);
      handByNote = new Map();
      partNotes[0].forEach((n, i) => handByNote.set(n, assigned.get(trackA[i]) ?? 'right'));
      partNotes[1].forEach((n, i) => handByNote.set(n, assigned.get(trackB[i]) ?? 'left'));
    } else {
      handByNote = assignByChordFallback();
    }
  } else {
    handByNote = assignByChordFallback();
  }

  const notes = allRawNotes
    .map((n) => toNoteEvent(n, handByNote.get(n) ?? 'right'))
    .sort((a, b) => a.time - b.time);

  const durationSeconds = notes.reduce((max, n) => Math.max(max, n.time + n.duration), 0);
  const timeEl = doc.getElementsByTagName('time')[0] ?? null;
  const beats = Number(timeEl && directChild(timeEl, 'beats')?.textContent?.trim()) || 4;
  const beatType = Number(timeEl && directChild(timeEl, 'beat-type')?.textContent?.trim()) || 4;

  return {
    id: crypto.randomUUID(),
    name: findTitle(doc) || file.name.replace(/\.[^.]+$/, ''),
    source: 'musicxml-import',
    notes,
    durationSeconds,
    createdAt: Date.now(),
    bpm: initialTempo,
    beatsPerMeasure: beats * (4 / beatType),
  };
}
