import { Song, PracticeAttempt } from '../lib/types';

interface ProgressDashboardProps {
  songs: Song[];
  attempts: PracticeAttempt[];
  onBack: () => void;
}

export function ProgressDashboard({ songs, attempts, onBack }: ProgressDashboardProps) {
  const rows = songs.map((song) => {
    const songAttempts = attempts.filter((a) => a.songId === song.id).sort((a, b) => a.timestamp - b.timestamp);
    const last = songAttempts[songAttempts.length - 1];
    const best = songAttempts.reduce((max, a) => Math.max(max, a.accuracy), 0);
    return { song, count: songAttempts.length, last, best };
  });

  return (
    <section className="progress-dashboard">
      <header className="practice-header">
        <button type="button" onClick={onBack}>
          ← 曲一覧
        </button>
        <h2>練習の進捗</h2>
      </header>

      {rows.length === 0 && <p>まだ練習記録がありません。</p>}

      <table className="progress-table">
        <thead>
          <tr>
            <th>曲</th>
            <th>練習回数</th>
            <th>直近の精度</th>
            <th>ベスト精度</th>
            <th>最終練習日</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ song, count, last, best }) => (
            <tr key={song.id}>
              <td>{song.name}</td>
              <td>{count}</td>
              <td>{last ? `${Math.round(last.accuracy * 100)}%` : '-'}</td>
              <td>{count > 0 ? `${Math.round(best * 100)}%` : '-'}</td>
              <td>{last ? new Date(last.timestamp).toLocaleDateString('ja-JP') : '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
