import { useMemo } from 'react';
import { engine } from '../engine/practiceEngine';
import { useEngineState } from '../engine/useEngine';
import { computeKeyboardLayout, computeSongRange } from '../lib/keyboardLayout';
import { filterNotesByHand } from '../lib/notes';
import type { Hand } from '../types';

export function PianoKeyboard() {
  const song = useEngineState((s) => s.song);
  const handFilter = useEngineState((s) => s.handFilter);
  const activeNoteIds = useEngineState((s) => s.activeNoteIds);
  const statuses = useEngineState((s) => s.statuses);
  const wrongFlashKeys = useEngineState((s) => s.wrongFlashKeys);
  const pressedKeys = useEngineState((s) => s.pressedKeys);

  const notes = useMemo(() => filterNotesByHand(song, handFilter), [song, handFilter]);

  const [minMidi, maxMidi] = useMemo(() => computeSongRange(notes), [notes]);

  const layout = useMemo(() => computeKeyboardLayout(minMidi, maxMidi, 1600), [minMidi, maxMidi]);

  const activeHandByMidi = useMemo(() => {
    const map = new Map<number, Hand>();
    for (const n of notes) {
      if (activeNoteIds.has(n.id)) map.set(n.midi, n.hand);
    }
    return map;
  }, [notes, activeNoteIds]);

  const hitMidiSet = useMemo(() => {
    const set = new Set<number>();
    for (const n of notes) {
      if (activeNoteIds.has(n.id) && statuses.get(n.id) === 'hit') set.add(n.midi);
    }
    return set;
  }, [notes, activeNoteIds, statuses]);

  const whiteKeys = layout.keys.filter((k) => !k.isBlack);
  const blackKeys = layout.keys.filter((k) => k.isBlack);

  const keyClass = (midi: number, isBlack: boolean) => {
    const classes = [isBlack ? 'key key-black' : 'key key-white'];
    if (pressedKeys.has(midi)) classes.push('key-pressed');
    if (hitMidiSet.has(midi)) classes.push('key-hit');
    else if (activeHandByMidi.has(midi)) {
      const hand = activeHandByMidi.get(midi);
      classes.push(hand === 'left' ? 'key-expected-left' : 'key-expected-right');
    }
    if (wrongFlashKeys.has(midi)) classes.push('key-wrong');
    return classes.join(' ');
  };

  const handlePress = (midi: number) => {
    const name = midiToName(midi);
    void engine.playKeyPreview(midi, name);
  };

  return (
    <div className="keyboard-wrap">
      <div className="keyboard" style={{ aspectRatio: `${layout.whiteCount} / 6` }}>
        {whiteKeys.map((k) => (
          <button
            key={k.midi}
            type="button"
            className={keyClass(k.midi, false)}
            style={{ left: `${(k.x / 1600) * 100}%`, width: `${(k.width / 1600) * 100}%` }}
            onClick={() => handlePress(k.midi)}
            aria-label={midiToName(k.midi)}
          />
        ))}
        {blackKeys.map((k) => (
          <button
            key={k.midi}
            type="button"
            className={keyClass(k.midi, true)}
            style={{ left: `${(k.x / 1600) * 100}%`, width: `${(k.width / 1600) * 100}%` }}
            onClick={() => handlePress(k.midi)}
            aria-label={midiToName(k.midi)}
          />
        ))}
      </div>
      <div className="keyboard-legend">
        <span className="legend-item"><i className="dot dot-right" /> 右手</span>
        <span className="legend-item"><i className="dot dot-left" /> 左手</span>
        <span className="legend-item"><i className="dot dot-hit" /> 正解</span>
        <span className="legend-item"><i className="dot dot-wrong" /> 違う音</span>
        <span className="legend-item"><i className="dot dot-pressed" /> 今押している鍵</span>
      </div>
    </div>
  );
}

function midiToName(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const octave = Math.floor(midi / 12) - 1;
  return `${names[midi % 12]}${octave}`;
}
