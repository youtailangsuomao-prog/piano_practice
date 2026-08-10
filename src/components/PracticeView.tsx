import { useEffect, useMemo, useReducer, useRef } from 'react';
import { Song, PracticeAttempt } from '../lib/types';
import { Chord, groupNotesIntoChords } from '../lib/chords';
import { midiToNoteName } from '../lib/notation';
import { usePianoInput } from '../hooks/usePianoInput';
import { PianoKeyboard } from './PianoKeyboard';

interface PracticeState {
  chordIndex: number;
  pressed: Set<number>;
  correct: number;
  wrong: number;
  wrongFlash: Set<number>;
  finished: boolean;
}

type Action = { type: 'note-on'; midi: number } | { type: 'clear-wrong-flash' } | { type: 'restart' };

function makeInitialState(): PracticeState {
  return { chordIndex: 0, pressed: new Set(), correct: 0, wrong: 0, wrongFlash: new Set(), finished: false };
}

function makeReducer(chords: Chord[]) {
  return (state: PracticeState, action: Action): PracticeState => {
    switch (action.type) {
      case 'restart':
        return makeInitialState();
      case 'clear-wrong-flash':
        return { ...state, wrongFlash: new Set() };
      case 'note-on': {
        if (state.finished) return state;
        const chord = chords[state.chordIndex];
        if (!chord) return state;
        const expected = new Set(chord.notes.map((n) => n.midi));

        if (expected.has(action.midi)) {
          if (state.pressed.has(action.midi)) return state;
          const pressed = new Set(state.pressed);
          pressed.add(action.midi);
          const correct = state.correct + 1;
          if (pressed.size === expected.size) {
            const chordIndex = state.chordIndex + 1;
            return {
              ...state,
              chordIndex,
              pressed: new Set(),
              correct,
              finished: chordIndex >= chords.length,
              wrongFlash: new Set(),
            };
          }
          return { ...state, pressed, correct };
        }

        return { ...state, wrong: state.wrong + 1, wrongFlash: new Set([action.midi]) };
      }
      default:
        return state;
    }
  };
}

interface PracticeViewProps {
  song: Song;
  onExit: () => void;
  onFinish: (attempt: PracticeAttempt) => void;
}

export function PracticeView({ song, onExit, onFinish }: PracticeViewProps) {
  const chords = useMemo(() => groupNotesIntoChords(song.notes), [song]);
  const notesTotal = useMemo(() => chords.reduce((sum, c) => sum + c.notes.length, 0), [chords]);
  const reducer = useMemo(() => makeReducer(chords), [chords]);
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState);
  const reportedRef = useRef(false);
  const pianoInput = usePianoInput();

  const { lowMidi, highMidi } = useMemo(() => {
    if (song.notes.length === 0) return { lowMidi: 60, highMidi: 72 };
    const midis = song.notes.map((n) => n.midi);
    return {
      lowMidi: Math.max(21, Math.min(...midis) - 2),
      highMidi: Math.min(108, Math.max(...midis) + 2),
    };
  }, [song]);

  useEffect(() => {
    reportedRef.current = false;
  }, [song]);

  useEffect(() => {
    return pianoInput.subscribe((event) => {
      if (event.on) dispatch({ type: 'note-on', midi: event.midi });
    });
  }, [pianoInput]);

  useEffect(() => {
    if (state.wrongFlash.size === 0) return;
    const timer = setTimeout(() => dispatch({ type: 'clear-wrong-flash' }), 350);
    return () => clearTimeout(timer);
  }, [state.wrongFlash]);

  useEffect(() => {
    if (!state.finished || reportedRef.current) return;
    reportedRef.current = true;
    const attempted = state.correct + state.wrong;
    onFinish({
      songId: song.id,
      timestamp: Date.now(),
      notesTotal,
      notesCorrect: state.correct,
      accuracy: attempted > 0 ? state.correct / attempted : 1,
    });
  }, [state.finished, state.correct, state.wrong, song.id, notesTotal, onFinish]);

  const currentChord = chords[state.chordIndex];
  const expectedMidis = useMemo(
    () => new Set(currentChord?.notes.map((n) => n.midi) ?? []),
    [currentChord],
  );
  const upcoming = chords.slice(state.chordIndex, state.chordIndex + 8);

  const attempted = state.correct + state.wrong;
  const liveAccuracy = attempted > 0 ? Math.round((state.correct / attempted) * 100) : 100;

  return (
    <section className="practice-view">
      <header className="practice-header">
        <button type="button" onClick={onExit}>
          ← 曲一覧
        </button>
        <h2>{song.name}</h2>
        <div className="stats">
          正解 {state.correct} / ミス {state.wrong} ・ 精度 {liveAccuracy}%
        </div>
      </header>

      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${chords.length ? (state.chordIndex / chords.length) * 100 : 0}%` }}
        />
      </div>

      {pianoInput.status !== 'connected' && (
        <div className="piano-connect">
          {pianoInput.status === 'unsupported' ? (
            <p>このブラウザはWeb MIDIに対応していません。下の鍵盤をクリックして練習できます。</p>
          ) : (
            <button type="button" onClick={pianoInput.connect} disabled={pianoInput.status === 'connecting'}>
              {pianoInput.status === 'connecting' ? '接続中...' : '電子ピアノを接続する'}
            </button>
          )}
          {pianoInput.error && <p className="error">{pianoInput.error}</p>}
        </div>
      )}
      {pianoInput.status === 'connected' && (
        <p className="piano-connected">
          接続中: {pianoInput.deviceNames.join(', ') || '入力デバイス'}
        </p>
      )}

      {!state.finished && currentChord && (
        <>
          <div className="upcoming-strip">
            {upcoming.map((chord, i) => (
              <div key={chord.time} className={`upcoming-chord ${i === 0 ? 'current' : ''}`}>
                {chord.notes.map((n) => midiToNoteName(n.midi)).join('+')}
              </div>
            ))}
          </div>

          <PianoKeyboard
            lowMidi={lowMidi}
            highMidi={highMidi}
            expected={expectedMidis}
            correct={state.pressed}
            wrong={state.wrongFlash}
            onKeyPress={(midi) => dispatch({ type: 'note-on', midi })}
          />
        </>
      )}

      {state.finished && (
        <div className="practice-complete">
          <h3>練習完了！</h3>
          <p>精度 {liveAccuracy}%（正解 {state.correct} / ミス {state.wrong}）</p>
          <div className="complete-actions">
            <button type="button" onClick={() => dispatch({ type: 'restart' })}>
              もう一度練習する
            </button>
            <button type="button" onClick={onExit}>
              曲一覧に戻る
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
