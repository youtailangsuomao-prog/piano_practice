import { ChangeEvent, useRef, useState } from 'react';
import { Song } from '../lib/types';
import { songFromMidiFile } from '../lib/songFromMidi';
import { songFromAudioFile } from '../lib/audioToSong';
import { songFromMusicXmlFile } from '../lib/songFromMusicXml';

const SOURCE_LABELS: Record<Song['source'], string> = {
  'midi-import': 'MIDI',
  'audio-transcription': '自動変換',
  'musicxml-import': '楽譜XML',
};

interface SongLibraryProps {
  songs: Song[];
  onAddSong: (song: Song) => void;
  onDeleteSong: (id: string) => void;
  onSelectSong: (id: string) => void;
}

export function SongLibrary({ songs, onAddSong, onDeleteSong, onSelectSong }: SongLibraryProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const midiInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const musicXmlInputRef = useRef<HTMLInputElement>(null);

  const handleMidiFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setBusy('MIDIファイルを読み込み中...');
    try {
      const song = await songFromMidiFile(file);
      onAddSong(song);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleMusicXmlFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setBusy('MusicXMLファイルを読み込み中...');
    try {
      const song = await songFromMusicXmlFile(file);
      onAddSong(song);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const handleAudioFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setError(null);
    setProgress(0);
    setBusy('音声を解析してMIDIに変換中...（初回はモデル読み込みで少し時間がかかります）');
    try {
      const song = await songFromAudioFile(file, setProgress);
      onAddSong(song);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="song-library">
      <h1>Piano Practice</h1>

      <div className="import-actions">
        <button type="button" onClick={() => midiInputRef.current?.click()} disabled={!!busy}>
          MIDIファイルを取り込む
        </button>
        <input
          ref={midiInputRef}
          type="file"
          accept=".mid,.midi"
          onChange={handleMidiFile}
          hidden
        />

        <button type="button" onClick={() => audioInputRef.current?.click()} disabled={!!busy}>
          音声ファイルから自動変換
        </button>
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*"
          onChange={handleAudioFile}
          hidden
        />

        <button type="button" onClick={() => musicXmlInputRef.current?.click()} disabled={!!busy}>
          MusicXMLを取り込む
        </button>
        <input
          ref={musicXmlInputRef}
          type="file"
          accept=".xml,.musicxml,.mxl"
          onChange={handleMusicXmlFile}
          hidden
        />
      </div>

      {busy && (
        <div className="busy-indicator">
          <p>{busy}</p>
          {progress > 0 && <progress value={progress} max={1} />}
        </div>
      )}
      {error && <p className="error">{error}</p>}

      <ul className="song-list">
        {songs.length === 0 && !busy && <li className="empty">まだ曲がありません。上のボタンから追加してください。</li>}
        {songs.map((song) => (
          <li key={song.id} className="song-item">
            <button type="button" className="song-select" onClick={() => onSelectSong(song.id)}>
              <span className="song-name">{song.name}</span>
              <span className="song-meta">
                {SOURCE_LABELS[song.source]} ・ {Math.round(song.durationSeconds)}秒 ・ {song.notes.length}音
              </span>
            </button>
            <button type="button" className="song-delete" onClick={() => onDeleteSong(song.id)} aria-label="削除">
              削除
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
