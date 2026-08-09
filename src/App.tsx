import './App.css';
import { FallingNotes } from './components/FallingNotes';
import { MidiConnectPanel } from './components/MidiConnectPanel';
import { PianoKeyboard } from './components/PianoKeyboard';
import { PracticeControls } from './components/PracticeControls';
import { ScorePanel } from './components/ScorePanel';
import { SongLoader } from './components/SongLoader';

function App() {
  return (
    <div id="app">
      <header className="app-header">
        <h1>ピアノ練習アプリ</h1>
        <p className="subtitle">MIDIファイルを読み込んで、電子ピアノで一緒に練習しよう</p>
      </header>

      <main className="app-main">
        <div className="sidebar">
          <SongLoader />
          <MidiConnectPanel />
          <PracticeControls />
          <ScorePanel />
        </div>

        <div className="stage">
          <FallingNotes />
          <PianoKeyboard />
        </div>
      </main>
    </div>
  );
}

export default App;
