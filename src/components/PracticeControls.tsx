import { engine, type HandFilter } from '../engine/practiceEngine';
import { useEngineState } from '../engine/useEngine';

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5];

export function PracticeControls() {
  const song = useEngineState((s) => s.song);
  const mode = useEngineState((s) => s.mode);
  const handFilter = useEngineState((s) => s.handFilter);
  const waitMode = useEngineState((s) => s.waitMode);
  const speed = useEngineState((s) => s.speed);
  const isPlaying = useEngineState((s) => s.isPlaying);
  const midiStatus = useEngineState((s) => s.midiStatus);

  const disabled = !song;

  return (
    <section className="panel">
      <h2>3. 練習する</h2>
      <div className="controls-grid">
        <div className="control-group">
          <span className="control-label">モード</span>
          <div className="segmented">
            <button
              type="button"
              className={mode === 'demo' ? 'active' : ''}
              onClick={() => engine.setMode('demo')}
              disabled={disabled}
            >
              お手本を聴く
            </button>
            <button
              type="button"
              className={mode === 'practice' ? 'active' : ''}
              onClick={() => engine.setMode('practice')}
              disabled={disabled}
            >
              練習する
            </button>
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">手</span>
          <div className="segmented">
            {(['both', 'right', 'left'] satisfies HandFilter[]).map((h) => (
              <button
                key={h}
                type="button"
                className={handFilter === h ? 'active' : ''}
                onClick={() => engine.setHandFilter(h)}
                disabled={disabled}
              >
                {h === 'both' ? '両手' : h === 'right' ? '右手のみ' : '左手のみ'}
              </button>
            ))}
          </div>
        </div>

        <div className="control-group">
          <span className="control-label">速さ</span>
          <div className="segmented">
            {SPEEDS.map((sp) => (
              <button
                key={sp}
                type="button"
                className={speed === sp ? 'active' : ''}
                onClick={() => engine.setSpeed(sp)}
                disabled={disabled}
              >
                {sp}x
              </button>
            ))}
          </div>
        </div>

        {mode === 'practice' && (
          <div className="control-group">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={waitMode}
                onChange={(e) => engine.setWaitMode(e.target.checked)}
                disabled={disabled}
              />
              正しい音を弾くまで待つ(初心者向け)
            </label>
          </div>
        )}
      </div>

      {mode === 'practice' && midiStatus !== 'connected' && (
        <p className="hint-text">
          MIDIキーボードを接続すると、実際に弾いた音を自動で判定します。未接続でも画面上の鍵盤をクリックして試せます。
        </p>
      )}

      <div className="transport">
        <button
          type="button"
          className="primary"
          onClick={() => (isPlaying ? engine.pause() : void engine.play())}
          disabled={disabled}
        >
          {isPlaying ? '一時停止' : '再生'}
        </button>
        <button type="button" onClick={() => engine.restart()} disabled={disabled}>
          最初から
        </button>
      </div>
    </section>
  );
}
