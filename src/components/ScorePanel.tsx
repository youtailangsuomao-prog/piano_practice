import { useEngineState } from '../engine/useEngine';

export function ScorePanel() {
  const mode = useEngineState((s) => s.mode);
  const score = useEngineState((s) => s.score);
  const song = useEngineState((s) => s.song);

  if (mode !== 'practice' || !song) return null;

  const total = score.hit + score.missed;
  const accuracy = total > 0 ? Math.round((score.hit / total) * 100) : 100;

  return (
    <section className="panel score-panel">
      <h2>スコア</h2>
      <div className="score-row">
        <div className="score-item score-hit">正解 {score.hit}</div>
        <div className="score-item score-missed">ミス {score.missed}</div>
        <div className="score-item score-wrong">違う音 {score.wrong}</div>
        <div className="score-item score-accuracy">正答率 {accuracy}%</div>
      </div>
    </section>
  );
}
