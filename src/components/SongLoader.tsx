import { useRef, useState } from 'react';
import { engine } from '../engine/practiceEngine';
import { useEngineState } from '../engine/useEngine';
import { loadSampleSong, parseMidiFile } from '../lib/midiFile';
import { SAMPLE_SONGS } from '../sampleSongs';

export function SongLoader() {
  const song = useEngineState((s) => s.song);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = async (file: File) => {
    setLoading(true);
    setError(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await parseMidiFile(buffer, file.name.replace(/\.(mid|midi)$/i, ''));
      if (parsed.notes.length === 0) throw new Error('この MIDI ファイルには音符が見つかりませんでした。');
      engine.loadSong(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleSample = async (url: string, name: string) => {
    setLoading(true);
    setError(null);
    try {
      const parsed = await loadSampleSong(url, name);
      engine.loadSong(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel">
      <h2>1. 曲を読み込む</h2>
      <div className="song-loader-row">
        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={loading}>
          MIDIファイルを選択(.mid)
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".mid,.midi,audio/midi"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleFile(file);
            e.target.value = '';
          }}
        />
        <span className="song-loader-hint">お手持ちの MIDI ファイルを読み込めます</span>
      </div>
      <div className="sample-songs">
        <span className="sample-songs-label">お試し用サンプル曲:</span>
        {SAMPLE_SONGS.map((s) => (
          <button
            key={s.id}
            type="button"
            className="sample-song-btn"
            onClick={() => handleSample(s.url, s.name)}
            disabled={loading}
          >
            {s.name}
          </button>
        ))}
      </div>
      {error && <p className="error-text">{error}</p>}
      {song && (
        <p className="song-loaded">
          読み込み中の曲: <strong>{song.name}</strong>(音符数: {song.notes.length} / 長さ: {Math.round(song.duration)}秒)
        </p>
      )}
    </section>
  );
}
