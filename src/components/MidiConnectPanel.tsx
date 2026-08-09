import { engine } from '../engine/practiceEngine';
import { useEngineState } from '../engine/useEngine';

export function MidiConnectPanel() {
  const supported = useEngineState((s) => s.midiSupported);
  const status = useEngineState((s) => s.midiStatus);
  const error = useEngineState((s) => s.midiError);
  const inputs = useEngineState((s) => s.midiInputs);
  const selectedId = useEngineState((s) => s.selectedInputId);

  return (
    <section className="panel">
      <h2>2. 電子ピアノ/キーボードと接続</h2>
      {!supported && (
        <p className="error-text">
          お使いのブラウザは Web MIDI API に対応していません。パソコンの Chrome または Edge でお試しください。
        </p>
      )}
      {supported && status === 'disconnected' && (
        <button type="button" onClick={() => void engine.connectMidi()}>
          MIDIデバイスに接続する
        </button>
      )}
      {status === 'connecting' && <p>接続中…</p>}
      {status === 'error' && (
        <>
          <p className="error-text">接続に失敗しました: {error}</p>
          <button type="button" onClick={() => void engine.connectMidi()}>
            再試行
          </button>
        </>
      )}
      {status === 'connected' && (
        <div className="midi-connected">
          <p>
            <span className="status-dot" /> 接続済み
          </p>
          {inputs.length === 0 && (
            <p className="hint-text">
              MIDI入力が見つかりません。ピアノをUSBまたはBluetoothでつないでから再試行してください。
            </p>
          )}
          {inputs.length > 0 && (
            <label className="midi-select">
              入力デバイス:
              <select value={selectedId ?? ''} onChange={(e) => engine.selectMidiInput(e.target.value)}>
                {inputs.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
