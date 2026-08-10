# piano_practice

電子ピアノを繋いで好きな曲を練習できるWebアプリです。

## 主な機能

- **MIDIファイルの取り込み**: `.mid`/`.midi` ファイルを読み込んで練習曲にできます。
- **音声からの自動変換**: mp3/wav などの音源をアップロードすると、[Spotify Basic Pitch](https://github.com/spotify/basic-pitch-ts) による自動採譜（音声→MIDI変換）でブラウザ上で練習用データを生成します。MIDIファイルが見つからない最新曲でも練習用データを作れます。
- **電子ピアノとの連携**: Web MIDI APIでUSB/Bluetooth接続の電子ピアノからの入力を受け取り、正しい音を弾けたか判定します。（対応ブラウザがない場合は画面上の鍵盤クリックでも練習できます）
- **進捗の記録**: 曲ごとの練習回数・精度・最終練習日をブラウザに保存して確認できます。

## 開発

```sh
npm install
npm run dev       # 開発サーバー起動
npm run build     # 型チェック + 本番ビルド
npm run typecheck # 型チェックのみ
```

## 技術スタック

- React + TypeScript + Vite
- Web MIDI API（電子ピアノ入力）
- `@tonejs/midi`（MIDIファイル読み込み）
- `@spotify/basic-pitch`（音声→MIDI自動変換、TensorFlow.jsベース）
