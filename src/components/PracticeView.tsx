import { useEffect, useMemo, useReducer, useRef, useState, useCallback } from 'react';
import { Song, PracticeAttempt, NoteEvent } from '../lib/types';
import { Chord, groupNotesIntoChords } from '../lib/chords';
import { buildPhrases } from '../lib/phrases';
import { playNotes, stopPlayback, PlaybackNoteEvent } from '../lib/synthPlayback';
import { loadSongProgress, saveSongProgress, clearSongProgress } from '../lib/songProgressStorage';
import { usePianoInput } from '../hooks/usePianoInput';
import { PianoNoteListener } from '../lib/webMidiInput';
import { PianoKeyboard } from './PianoKeyboard';
import { NoteWaterfall } from './NoteWaterfall';

const BEGINNER_MEASURES_PER_PHRASE = 4;
const ADVANCED_MEASURE_OPTIONS = [8, 16];
const ADVANCED_HIT_TOLERANCE_SECONDS = 0.35;

/** Keyboard range covering just the given notes (±2 semitones), so the keyboard zooms
 * to whatever's actually being practiced right now instead of the whole song's range. */
function computeKeyRange(notes: NoteEvent[]): { lowMidi: number; highMidi: number } {
  if (notes.length === 0) return { lowMidi: 60, highMidi: 72 };
  const midis = notes.map((n) => n.midi);
  return {
    lowMidi: Math.max(21, Math.min(...midis) - 2),
    highMidi: Math.min(108, Math.max(...midis) + 2),
  };
}

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

/** Beginner mode: waits at each chord until it's played correctly before advancing. */
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

interface AdvancedPerformProps {
  notes: NoteEvent[];
  startTime: number;
  endTime: number;
  lowMidi: number;
  highMidi: number;
  subscribe: (listener: PianoNoteListener) => () => void;
  onComplete: (correct: number, wrong: number) => void;
}

/**
 * Advanced mode: the reference performance plays straight through in real time and never
 * pauses, however well or badly you keep up. Each played note is matched against the
 * nearest not-yet-matched expected note of the same pitch within a small timing window;
 * anything expected but never played counts against you at the end, same as a stray press.
 */
function AdvancedPerform({ notes, startTime, endTime, lowMidi, highMidi, subscribe, onComplete }: AdvancedPerformProps) {
  const [playbackTime, setPlaybackTime] = useState(startTime);
  const [playingRight, setPlayingRight] = useState<Set<number>>(new Set());
  const [playingLeft, setPlayingLeft] = useState<Set<number>>(new Set());
  const [hitFlash, setHitFlash] = useState<Set<number>>(new Set());
  const [missFlash, setMissFlash] = useState<Set<number>>(new Set());
  const [correct, setCorrect] = useState(0);
  const [wrong, setWrong] = useState(0);

  const playbackTimeRef = useRef(startTime);
  const matchedRef = useRef<Set<number>>(new Set());
  const correctRef = useRef(0);
  const wrongRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const reportedRef = useRef(false);

  const handleUserNoteOn = useCallback(
    (midi: number) => {
      const now = playbackTimeRef.current;
      let bestIndex = -1;
      let bestDelta = Infinity;
      notes.forEach((note, i) => {
        if (matchedRef.current.has(i) || note.midi !== midi) return;
        const delta = Math.abs(note.time - now);
        if (delta <= ADVANCED_HIT_TOLERANCE_SECONDS && delta < bestDelta) {
          bestDelta = delta;
          bestIndex = i;
        }
      });

      if (bestIndex !== -1) {
        matchedRef.current.add(bestIndex);
        correctRef.current += 1;
        setCorrect(correctRef.current);
        setHitFlash((prev) => new Set(prev).add(midi));
        setTimeout(() => setHitFlash((prev) => { const n = new Set(prev); n.delete(midi); return n; }), 250);
      } else {
        wrongRef.current += 1;
        setWrong(wrongRef.current);
        setMissFlash((prev) => new Set(prev).add(midi));
        setTimeout(() => setMissFlash((prev) => { const n = new Set(prev); n.delete(midi); return n; }), 250);
      }
    },
    [notes],
  );

  useEffect(() => {
    return subscribe((event) => {
      if (event.on) handleUserNoteOn(event.midi);
    });
  }, [subscribe, handleUserNoteOn]);

  useEffect(() => {
    const startWallTime = performance.now();

    const tick = () => {
      const elapsed = (performance.now() - startWallTime) / 1000;
      const t = startTime + elapsed;
      playbackTimeRef.current = t;
      if (t >= endTime) {
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

    void playNotes(notes, startTime, handleNoteEvent).finally(() => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (!reportedRef.current) {
        reportedRef.current = true;
        const missed = notes.length - matchedRef.current.size;
        onComplete(correctRef.current, wrongRef.current + missed);
      }
    });

    return () => {
      stopPlayback();
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
    // Intentionally scoped to the phrase identity only; onComplete is stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notes, startTime, endTime]);

  return (
    <>
      <div className="stats">この区間: 正解 {correct} / ミス {wrong}</div>
      <NoteWaterfall lowMidi={lowMidi} highMidi={highMidi} notes={notes} currentTime={playbackTime} />
      <PianoKeyboard
        lowMidi={lowMidi}
        highMidi={highMidi}
        expectedRight={playingRight}
        expectedLeft={playingLeft}
        correct={hitFlash}
        wrong={missFlash}
        onKeyPress={handleUserNoteOn}
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
type AdvancedStage = 'intro' | 'perform' | 'result';
type Mode = 'beginner' | 'advanced';

export function PracticeView({ song, onExit, onFinish }: PracticeViewProps) {
  const pianoInput = usePianoInput();
  const [mode, setModeState] = useState<Mode>('beginner');

  // ---- Beginner mode state ----
  const beginnerPhrases = useMemo(() => buildPhrases(song, BEGINNER_MEASURES_PER_PHRASE), [song]);
  const savedProgress = useMemo(() => loadSongProgress(song.id), [song.id]);

  const initialPhraseIndex = Math.min(savedProgress?.phraseIndex ?? 0, Math.max(beginnerPhrases.length - 1, 0));
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

  const currentPhrase = beginnerPhrases[phraseIndex];
  const phraseChords = useMemo(() => groupNotesIntoChords(currentPhrase?.notes ?? []), [currentPhrase]);
  const { lowMidi, highMidi } = useMemo(
    () => computeKeyRange(currentPhrase?.notes ?? song.notes),
    [currentPhrase, song.notes],
  );

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
    if (phraseIndex + 1 >= beginnerPhrases.length) {
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

  // ---- Advanced mode state ----
  const [measuresPerPhrase, setMeasuresPerPhrase] = useState(ADVANCED_MEASURE_OPTIONS[0]);
  const advancedPhrases = useMemo(() => buildPhrases(song, measuresPerPhrase), [song, measuresPerPhrase]);
  const [advPhraseIndex, setAdvPhraseIndex] = useState(0);
  const [advFurthest, setAdvFurthest] = useState(0);
  const [advStage, setAdvStage] = useState<AdvancedStage>('intro');
  const [advAttemptKey, setAdvAttemptKey] = useState(0);
  const [advLastResult, setAdvLastResult] = useState<{ correct: number; wrong: number } | null>(null);
  const [advTotals, setAdvTotals] = useState({ correct: 0, wrong: 0 });
  const [advSongFinished, setAdvSongFinished] = useState(false);
  const prevAdvSongFinishedRef = useRef(false);

  useEffect(() => {
    setAdvFurthest((f) => Math.max(f, advPhraseIndex));
  }, [advPhraseIndex]);

  // Longer/shorter phrase segments shift phrase boundaries entirely, so start over.
  useEffect(() => {
    setAdvPhraseIndex(0);
    setAdvFurthest(0);
    setAdvStage('intro');
    setAdvAttemptKey((k) => k + 1);
    setAdvTotals({ correct: 0, wrong: 0 });
    setAdvSongFinished(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measuresPerPhrase, song.id]);

  const currentAdvPhrase = advancedPhrases[advPhraseIndex];
  const { lowMidi: advLowMidi, highMidi: advHighMidi } = useMemo(
    () => computeKeyRange(currentAdvPhrase?.notes ?? song.notes),
    [currentAdvPhrase, song.notes],
  );

  const handleAdvancedPerform = () => {
    stopPlayback();
    setAdvStage('perform');
  };

  const handleAdvancedComplete = useCallback((correct: number, wrong: number) => {
    setAdvTotals((t) => ({ correct: t.correct + correct, wrong: t.wrong + wrong }));
    setAdvLastResult({ correct, wrong });
    setAdvStage('result');
  }, []);

  const handleAdvancedRetry = () => {
    stopPlayback();
    setAdvAttemptKey((k) => k + 1);
    setAdvStage('intro');
  };

  const handleAdvancedNext = () => {
    stopPlayback();
    if (advPhraseIndex + 1 >= advancedPhrases.length) {
      setAdvSongFinished(true);
      return;
    }
    setAdvPhraseIndex((i) => i + 1);
    setAdvAttemptKey((k) => k + 1);
    setAdvStage('intro');
  };

  const handleAdvancedSelect = (index: number) => {
    if (index > advFurthest) return;
    stopPlayback();
    setAdvPhraseIndex(index);
    setAdvAttemptKey((k) => k + 1);
    setAdvStage('intro');
    setAdvSongFinished(false);
  };

  useEffect(() => {
    if (advSongFinished && !prevAdvSongFinishedRef.current) {
      const attemptedAdv = advTotals.correct + advTotals.wrong;
      onFinish({
        songId: song.id,
        timestamp: Date.now(),
        notesTotal: song.notes.length,
        notesCorrect: advTotals.correct,
        accuracy: attemptedAdv > 0 ? advTotals.correct / attemptedAdv : 1,
      });
    }
    prevAdvSongFinishedRef.current = advSongFinished;
  }, [advSongFinished, advTotals, song.id, song.notes.length, onFinish]);

  const advAttempted = advTotals.correct + advTotals.wrong;
  const advLiveAccuracy = advAttempted > 0 ? Math.round((advTotals.correct / advAttempted) * 100) : 100;

  const handleSetMode = (m: Mode) => {
    if (m === mode) return;
    stopPlayback();
    stopPlaybackVisuals();
    setModeState(m);
  };

  return (
    <section className="practice-view">
      <header className="practice-header">
        <button type="button" onClick={onExit}>
          ← 曲一覧
        </button>
        <h2>{song.name}</h2>
        <div className="stats">
          {mode === 'beginner' ? (
            <>
              正解 {totals.correct} / ミス {totals.wrong} ・ 精度 {liveAccuracy}%
            </>
          ) : (
            <>
              正解 {advTotals.correct} / ミス {advTotals.wrong} ・ 精度 {advLiveAccuracy}%
            </>
          )}
        </div>
      </header>

      <div className="mode-toggle">
        <button type="button" className={mode === 'beginner' ? 'active' : ''} onClick={() => handleSetMode('beginner')}>
          初級モード
        </button>
        <button type="button" className={mode === 'advanced' ? 'active' : ''} onClick={() => handleSetMode('advanced')}>
          上級モード
        </button>
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
        <p className="piano-connected">接続中: {pianoInput.deviceNames.join(', ') || '入力デバイス'}</p>
      )}

      {mode === 'beginner' && (
        <>
          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${beginnerPhrases.length ? (furthestPhraseIndex / beginnerPhrases.length) * 100 : 0}%` }}
            />
          </div>

          {beginnerPhrases.length > 1 && (
            <div className="phrase-list">
              {beginnerPhrases.map((_, i) => {
                const done = i < furthestPhraseIndex || songFinished;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`phrase-pill ${i === phraseIndex && !songFinished ? 'current' : ''} ${done ? 'done' : ''}`}
                    onClick={() => handleSelectPhrase(i)}
                    title={`フレーズ${i + 1}を練習する`}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          )}

          {!songFinished && currentPhrase && (
            <>
              <p className="stats">
                フレーズ {phraseIndex + 1} / {beginnerPhrases.length}
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
                          {phraseIndex + 1 >= beginnerPhrases.length ? '曲を完了する' : '次のフレーズへ →'}
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
        </>
      )}

      {mode === 'advanced' && (
        <>
          <p>音楽に合わせて最後まで弾き通すモードです。ミスをしても止まらず先に進みます。</p>

          <div className="measure-length-select">
            <span>区間の長さ:</span>
            {ADVANCED_MEASURE_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                className={measuresPerPhrase === m ? 'active' : ''}
                onClick={() => setMeasuresPerPhrase(m)}
              >
                {m}小節
              </button>
            ))}
          </div>

          <div className="progress-bar">
            <div
              className="progress-bar-fill"
              style={{ width: `${advancedPhrases.length ? (advFurthest / advancedPhrases.length) * 100 : 0}%` }}
            />
          </div>

          {advancedPhrases.length > 1 && (
            <div className="phrase-list">
              {advancedPhrases.map((_, i) => {
                const locked = i > advFurthest;
                const done = i < advFurthest || advSongFinished;
                return (
                  <button
                    key={i}
                    type="button"
                    className={`phrase-pill ${i === advPhraseIndex && !advSongFinished ? 'current' : ''} ${done ? 'done' : ''} ${locked ? 'locked' : ''}`}
                    disabled={locked}
                    onClick={() => handleAdvancedSelect(i)}
                  >
                    {i + 1}
                  </button>
                );
              })}
            </div>
          )}

          {!advSongFinished && currentAdvPhrase && (
            <>
              <p className="stats">
                区間 {advPhraseIndex + 1} / {advancedPhrases.length}（{measuresPerPhrase}小節ずつ）
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

              {advStage === 'intro' && (
                <div className="phrase-intro">
                  <p>準備ができたら演奏を始めましょう。</p>
                  <div className="phrase-actions">
                    <button type="button" onClick={handleAdvancedPerform}>
                      ▶ 演奏する
                    </button>
                  </div>
                </div>
              )}

              {advStage === 'perform' && (
                <AdvancedPerform
                  key={advAttemptKey}
                  notes={currentAdvPhrase.notes}
                  startTime={currentAdvPhrase.startTime}
                  endTime={currentAdvPhrase.endTime}
                  lowMidi={advLowMidi}
                  highMidi={advHighMidi}
                  subscribe={pianoInput.subscribe}
                  onComplete={handleAdvancedComplete}
                />
              )}

              {advStage === 'result' && advLastResult && (
                <div className="phrase-result">
                  <p>
                    正解 {advLastResult.correct} / ミス {advLastResult.wrong}
                  </p>
                  <div className="phrase-actions">
                    <button type="button" onClick={handleAdvancedRetry}>
                      🔁 もう一度演奏する
                    </button>
                    <button type="button" onClick={handleAdvancedNext}>
                      {advPhraseIndex + 1 >= advancedPhrases.length ? '区間を完了する' : '次の区間へ →'}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {advSongFinished && (
            <div className="practice-complete">
              <h3>通し演奏 完了！</h3>
              <p>
                精度 {advLiveAccuracy}%（正解 {advTotals.correct} / ミス {advTotals.wrong}）
              </p>
              <div className="complete-actions">
                <button type="button" onClick={onExit}>
                  曲一覧に戻る
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
