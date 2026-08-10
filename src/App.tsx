import { useCallback, useState } from 'react';
import { Song, PracticeAttempt } from './lib/types';
import { loadSongs, saveSong, deleteSong } from './lib/songStorage';
import { loadAttempts, saveAttempt } from './lib/progressStorage';
import { SongLibrary } from './components/SongLibrary';
import { PracticeView } from './components/PracticeView';
import { ProgressDashboard } from './components/ProgressDashboard';

type View = { name: 'library' } | { name: 'practice'; songId: string } | { name: 'progress' };

export default function App() {
  const [songs, setSongs] = useState<Song[]>(() => loadSongs());
  const [attempts, setAttempts] = useState<PracticeAttempt[]>(() => loadAttempts());
  const [view, setView] = useState<View>({ name: 'library' });

  const handleAddSong = useCallback((song: Song) => {
    setSongs(saveSong(song));
  }, []);

  const handleDeleteSong = useCallback((id: string) => {
    setSongs(deleteSong(id));
  }, []);

  const handleFinishPractice = useCallback((attempt: PracticeAttempt) => {
    setAttempts(saveAttempt(attempt));
  }, []);

  const selectedSong = view.name === 'practice' ? songs.find((s) => s.id === view.songId) : undefined;

  return (
    <div className="app">
      {view.name === 'library' && (
        <>
          <SongLibrary
            songs={songs}
            onAddSong={handleAddSong}
            onDeleteSong={handleDeleteSong}
            onSelectSong={(songId) => setView({ name: 'practice', songId })}
          />
          <button type="button" className="progress-link" onClick={() => setView({ name: 'progress' })}>
            練習の進捗を見る
          </button>
        </>
      )}

      {view.name === 'practice' && selectedSong && (
        <PracticeView
          song={selectedSong}
          onExit={() => setView({ name: 'library' })}
          onFinish={handleFinishPractice}
        />
      )}

      {view.name === 'progress' && (
        <ProgressDashboard songs={songs} attempts={attempts} onBack={() => setView({ name: 'library' })} />
      )}
    </div>
  );
}
