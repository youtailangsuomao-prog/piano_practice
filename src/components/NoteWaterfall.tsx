import { useMemo } from 'react';
import { NoteEvent } from '../lib/types';
import { keyPosition, layoutKeys } from '../lib/keyboardLayout';

const PIXELS_PER_SECOND = 60;
const LOOKAHEAD_SECONDS = 4;
const MIN_NOTE_HEIGHT = 8;

export interface NoteWaterfallProps {
  lowMidi: number;
  highMidi: number;
  notes: NoteEvent[];
  /** The time (in the song's original timeline) of the note the player must play right now. */
  currentTime: number;
  /**
   * Whether position changes should ease with a CSS transition. Turn this off when
   * `currentTime` already updates continuously (a real-time clock, many times a
   * second) — transitioning every one of those tiny steps makes the notes visibly lag
   * behind their true position. Leave it on for discrete jumps (e.g. advancing once
   * per chord), where the animated fall is the point. Defaults to off.
   */
  animated?: boolean;
}

export function NoteWaterfall({ lowMidi, highMidi, notes, currentTime, animated = false }: NoteWaterfallProps) {
  const { width: totalWidth } = layoutKeys(lowMidi, highMidi);
  const viewportHeight = LOOKAHEAD_SECONDS * PIXELS_PER_SECOND;

  const visibleNotes = useMemo(
    () => notes.filter((n) => n.time >= currentTime - 0.05 && n.time <= currentTime + LOOKAHEAD_SECONDS),
    [notes, currentTime],
  );

  // Each note keeps a fixed position within a long inner track; only the track's
  // translateY changes as currentTime advances, which lets the browser animate a
  // smooth "fall" toward the keyboard via a CSS transition instead of us re-laying
  // out every note on every chord.
  const trackOffset = (LOOKAHEAD_SECONDS + currentTime) * PIXELS_PER_SECOND;

  return (
    <div className="note-waterfall" style={{ height: viewportHeight }}>
      <div
        className="note-waterfall-track"
        style={{ transform: `translateY(${trackOffset}px)`, transition: animated ? undefined : 'none' }}
      >
        {visibleNotes.map((note, i) => {
          const { x, width: keyWidth } = keyPosition(note.midi, lowMidi, highMidi);
          const isNow = note.time <= currentTime + 0.01;
          return (
            <div
              key={`${note.midi}-${note.time}-${i}`}
              className={`falling-note ${note.hand === 'left' ? 'falling-note-left' : 'falling-note-right'} ${
                isNow ? 'falling-note-now' : ''
              }`}
              style={{
                left: `${(x / totalWidth) * 100}%`,
                width: `${(keyWidth / totalWidth) * 100}%`,
                top: -note.time * PIXELS_PER_SECOND,
                height: Math.max(note.duration * PIXELS_PER_SECOND, MIN_NOTE_HEIGHT),
              }}
            />
          );
        })}
      </div>
      <div className="note-waterfall-hitline" />
    </div>
  );
}
