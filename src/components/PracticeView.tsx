import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react';
import { Song, PracticeAttempt } from '../lib/types';
import { Chord, groupNotesIntoChords } from '../lib/chords';
import { buildPhrases } from '../lib/phrases';
import { playNotes, stopPlayback, PlaybackNoteEvent } from '../lib/synthPlayback';
import { loadSongProgress, saveSongProgress, clearSongProgress } from '../lib/songProgressStorage';
import { usePianoInput } from '../hooks/usePianoInput';
import { PianoNoteListener } from '../lib/webMidiInput';
import { PianoKeyboard } from './PianoKeyboard';
import { NoteWaterfall } from './NoteWaterfall';

interface AttemptState {
  chordIndex: number;
  pressed: Set<number>;
  correct: number;
  wrong: number;
  wrongFlash: Set<number>;
  finished: boolean;
}

type Action = { type: 'note-on'; midi: number } | { type: 'clear-wrong-flash' };

function makeInitialState(): AttemptState {
  return { chordIndex: 0, pressed: new Set(), correct: 0, wrong: 0, wrongFlash: new Set(), finished: false };
}

function makeReducer(chords: Chord[]) {
  return (state: AttemptState, action: Action): AttemptState => {
    switch (action.type) {
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

interface PhraseAttemptProps {
  chords: Chord[];
  lowMidi: number;
  highMidi: number;
  subscribe: (listener: PianoNoteListener) => () => void;
  onComplete: (correct: number, wrong: number) => void;
}

function PhraseAttempt({ chords, lowMidi, highMidi, subscribe, onComplete }: PhraseAttemptProps) {
  const reducer = useMemo(() => makeReducer(chords), [chords]);
  const [state, dispatch] = useReducer(reducer, undefined, makeInitialState);
  const reportedRef = useRef(false);

  useEffect(() => {
    return subscribe((event) => {
      if (event.on) dispatch({ type: 'note-on', midi: event.midi });
    });
  }, [subscribe]);

  useEffect(() => {
    if (state.wrongFlash.size === 0) return;
    const timer = setTimeout(() => dispatch({ type: 'clear-wrong-flash' }), 350);
    return () => clearTimeout(timer);
  }, [state.wrongFlash]);

  useEffect(() => {
    if (state.finished && !reportedRef.current) {
      reportedRef.current = true;
      onComplete(state.correct, state.wrong);
    }
  }, [state.finished, state.correct, state.wrong, onComplete]);

  const currentChord = chords[state.chordIndex];
  const currentTime = currentChord?.time ?? chords[chords.length - 1]?.time ?? 0;
  const allNotes = useMemo(() => chords.flatMap((c) => c.notes), [chords]);
  const expectedRight = useMemo(
    () => new Set((currentChord?.notes ?? []).filter((n) => n.hand !== 'left').map((n) => n.midi)),
    [currentChord],
  );
  const expectedLeft = useMemo(
    () => new Set((currentChord?.notes ?? []).filter((n) => n.hand === 'left').map((n) => n.midi)),
    [currentChord],
  );

  return (
    <>
      <div className="stats">この区間: 正解 {state.correct} / ミス {state.wrong}</div>
      <NoteWaterfall lowMidi={lowMidi} highMidi={highMidi} notes={allNotes} currentTime={currentTime} />
      <PianoKeyboard
        lowMidi={lowMidi}
        highMidi={highMidi}
        expectedRight={expectedRight}
        expectedLeft={expectedLeft}
        correct={state.pressed}
        wrong={state.wrongFlash}
        onKeyPress={(midi) => dispatch({ type: 'note-on', midi })}
      />
    </>
  );
}

interface PracticeViewProps {
  song: Song;
  onExit: () => void;
  onFinish: (attempt: PracticeAttempt) => void;
}

type Stage = 'intro' | 'attempt' | 'result';

export function PracticeView({ song, onExit, onFinish }: PracticeViewProps) {
  const phrases = useMemo(() => buildPhrases(song), [song]);
  const pianoInput = usePianoInput();
  const savedProgress = useMemo(() => loadSongProgress(song.id), [song.id]);

  const initialPhraseIndex = Math.min(savedProgress?.phraseIndex ?? 0, Math.max(phrases.length - 1, 0));
  const [phraseIndex, setPhraseIndex] = useState(initialPhraseIndex);
  // The furthest phrase reached so far: resuming continues from here, and only phrases up
  // to this point are unlocked for (re)selection. Navigating back to replay an earlier
  // phrase moves `phraseIndex` without moving this backward.
  const [furthestPhraseIndex, setFurthestPhraseIndex] = useState(initialPhraseIndex);
  const [attemptKey, setAttemptKey] = useState(0);
  const [stage, setStage] = useState<Stage>('intro');
  const [lastResult, setLastResult] = useState<{ correct: number; wrong: number } | null>(null);
  const [totals, setTotals] = useState(() => ({
    correct: savedProgress?.totalsCorrect ?? 0,
    wrong: savedProgress?.totalsWrong ?? 0,
  }));
  const [songFinished, setSongFinished] = useState(false);
  const prevSongFinishedRef = useRef(false);

  useEffect(() => {
    setFurthestPhraseIndex((f) => Math.max(f, phraseIndex));
  }, [phraseIndex]);

  // Playback visuals: which notes are currently sounding, and where in the song we are,
  // while auditioning a phrase (as opposed to the chord-index-driven state during an attempt).
  const [playbackTime, setPlaybackTime] = useState<number | null>(null);
  const [playingRight, setPlayingRight] = useState<Set<number>>(new Set());
  const [playingLeft, setPlayingLeft] = useState<Set<number>>(new Set());
  const rafRef = useRef<number | null>(null);

  const stopPlaybackVisuals = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setPlaybackTime(null);
    setPlayingRight(new Set());
    setPlayingLeft(new Set());
  }, []);

  useEffect(
    () => () => {
      stopPlayback();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    [],
  );

  const { lowMidi, highMidi } = useMemo(() => {
    if (song.notes.length === 0) return { lowMidi: 60, highMidi: 72 };
    const midis = song.notes.map((n) => n.midi);
    return {
      lowMidi: Math.max(21, Math.min(...midis) - 2),
      highMidi: Math.min(108, Math.max(...midis) + 2),
    };
  }, [song]);

  const currentPhrase = phrases[phraseIndex];
  const phraseChords = useMemo(() => groupNotesIntoChords(currentPhrase?.notes ?? []), [currentPhrase]);

  const handleListen = useCallback(() => {
    if (!currentPhrase) return;
    stopPlaybackVisuals();
    const phrase = currentPhrase;
    const startWallTime = performance.now();
    setPlaybackTime(phrase.startTime);

    const tick = () => {
      const elapsed = (performance.now() - startWallTime) / 1000;
      const t = phrase.startTime + elapsed;
      if (t >= phrase.endTime) {
        rafRef.current = null;
        return;
      }
      setPlaybackTime(t);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    const handleNoteEvent = (event: PlaybackNoteEvent) => {
      const setter = event.hand === 'left' ? setPlayingLeft : setPlayingRight;
      setter((prev) => {
        const next = new Set(prev);
        if (event.on) next.add(event.midi);
        else next.delete(event.midi);
        return next;
      });
    };

    void playNotes(phrase.notes, phrase.startTime, handleNoteEvent).finally(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      setPlaybackTime(null);
    });
  }, [currentPhrase, stopPlaybackVisuals]);

  const handleStartAttempt = () => {
    stopPlayback();
    stopPlaybackVisuals();
    setStage('attempt');
  };

  const handleAttemptComplete = useCallback((correct: number, wrong: number) => {
    setTotals((t) => ({ correct: t.correct + correct, wrong: t.wrong + wrong }));
    setLastResult({ correct, wrong });
    setStage('result');
  }, []);

  const handleNextPhrase = () => {
    stopPlayback();
    stopPlaybackVisuals();
    if (phraseIndex + 1 >= phrases.length) {
      setSongFinished(true);
      return;
    }
    setPhraseIndex((i) => i + 1);
    setAttemptKey((k) => k + 1);
    setStage('intro');
  };

  const handleRetryPhrase = () => {
    stopPlayback();
    stopPlaybackVisuals();
    setAttemptKey((k) => k + 1);
    setStage('intro');
  };

  const handleSelectPhrase = (index: number) => {
    if (index > furthestPhraseIndex) return;
    stopPlayback();
    stopPlaybackVisuals();
    setPhraseIndex(index);
    setAttemptKey((k) => k + 1);
    setStage('intro');
    setSongFinished(false);
  };

  useEffect(() => {
    if (songFinished) return;
    saveSongProgress({
      songId: song.id,
      phraseIndex: furthestPhraseIndex,
      totalsCorrect: totals.correct,
      totalsWrong: totals.wrong,
      updatedAt: Date.now(),
    });
  }, [song.id, furthestPhraseIndex, totals, songFinished]);

  useEffect(() => {
    if (songFinished && !prevSongFinishedRef.current) {
      clearSongProgress(song.id);
      const attempted = totals.correct + totals.wrong;
      onFinish({
        songId: song.id,
        timestamp: Date.now(),
        notesTotal: song.notes.length,
        notesCorrect: totals.correct,
        accuracy: attempted > 0 ? totals.correct / attempted : 1,
      });
    }
    prevSongFinishedRef.current = songFinished;
  }, [songFinished, totals, song.id, song.notes.length, onFinish]);

  const attempted = totals.correct + totals.wrong;
  const liveAccuracy = attempted > 0 ? Math.round((totals.correct / attempted) * 100) : 100;

  return (
    <section className="practice-view">
      <header className="practice-header">
        <button type="button" onClick={onExit}>
          ← 曲一覧
        </button>
        <h2>{song.name}</h2>
        <div className="stats">
          正解 {totals.correct} / ミス {totals.wrong} ・ 精度 {liveAccuracy}%
        </div>
      </header>

      <div className="progress-bar">
        <div
          className="progress-bar-fill"
          style={{ width: `${phrases.length ? (furthestPhraseIndex / phrases.length) * 100 : 0}%` }}
        />
      </div>

      {phrases.length > 1 && (
        <div className="phrase-list">
          {phrases.map((_, i) => {
            const locked = i > furthestPhraseIndex;
            const done = i < furthestPhraseIndex || songFinished;
            return (
              <button
                key={i}
                type="button"
                className={`phrase-pill ${i === phraseIndex && !songFinished ? 'current' : ''} ${done ? 'done' : ''} ${locked ? 'locked' : ''}`}
                disabled={locked}
                onClick={() => handleSelectPhrase(i)}
                title={locked ? 'まだ到達していません' : `フレーズ${i + 1}を練習する`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
      )}

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
        <p className="piano-connected">接続中: {pianoInput.deviceNames.join(', ') || '入力デバイス'}</p>
      )}

      {!songFinished && currentPhrase && (
        <>
          <p className="stats">
            フレーズ {phraseIndex + 1} / {phrases.length}
          </p>

          <div className="hand-legend">
            <span>
              <span className="hand-swatch right" />
              右手
            </span>
            <span>
              <span className="hand-swatch left" />
              左手
            </span>
          </div>

          {stage === 'intro' && (
            <div className="phrase-intro">
              <p>お手本を聴いてから弾いてみましょう。</p>
              <div className="phrase-actions">
                <button type="button" onClick={handleListen}>
                  ▶ お手本を聴く
                </button>
                <button type="button" onClick={handleStartAttempt}>
                  🎹 弾いてみる
                </button>
              </div>
            </div>
          )}

          {stage === 'attempt' ? (
            <PhraseAttempt
              key={attemptKey}
              chords={phraseChords}
              lowMidi={lowMidi}
              highMidi={highMidi}
              subscribe={pianoInput.subscribe}
              onComplete={handleAttemptComplete}
            />
          ) : (
            <>
              <NoteWaterfall
                lowMidi={lowMidi}
                highMidi={highMidi}
                notes={currentPhrase.notes}
                currentTime={playbackTime ?? currentPhrase.startTime}
              />
              <PianoKeyboard
                lowMidi={lowMidi}
                highMidi={highMidi}
                expectedRight={playingRight}
                expectedLeft={playingLeft}
              />
            </>
          )}

          {stage === 'result' && lastResult && (
            <div className="phrase-result">
              {lastResult.wrong === 0 ? (
                <>
                  <p>できました！</p>
                  <div className="phrase-actions">
                    <button type="button" onClick={handleNextPhrase}>
                      {phraseIndex + 1 >= phrases.length ? '曲を完了する' : '次のフレーズへ →'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p>ミスが{lastResult.wrong}回ありました。もう一度聴いてから挑戦してみましょう。</p>
                  <div className="phrase-actions">
                    <button type="button" onClick={handleListen}>
                      ▶ もう一度聴く
                    </button>
                    <button type="button" onClick={handleRetryPhrase}>
                      🎹 もう一度弾く
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}

      {songFinished && (
        <div className="practice-complete">
          <h3>練習完了！</h3>
          <p>
            精度 {liveAccuracy}%（正解 {totals.correct} / ミス {totals.wrong}）
          </p>
          <div className="complete-actions">
            <button type="button" onClick={onExit}>
              曲一覧に戻る
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
