const WHITE_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);
const WHITE_KEY_WIDTH = 32;
const BLACK_KEY_WIDTH = 20;
const WHITE_KEY_HEIGHT = 140;
const BLACK_KEY_HEIGHT = 88;

function isWhiteKey(midi: number): boolean {
  return WHITE_PITCH_CLASSES.has(((midi % 12) + 12) % 12);
}

interface KeyLayout {
  midi: number;
  isWhite: boolean;
  x: number;
}

function layoutKeys(lowMidi: number, highMidi: number): { keys: KeyLayout[]; width: number } {
  const keys: KeyLayout[] = [];
  let whiteCount = 0;
  for (let midi = lowMidi; midi <= highMidi; midi++) {
    if (isWhiteKey(midi)) {
      keys.push({ midi, isWhite: true, x: whiteCount * WHITE_KEY_WIDTH });
      whiteCount += 1;
    } else {
      keys.push({ midi, isWhite: false, x: whiteCount * WHITE_KEY_WIDTH - BLACK_KEY_WIDTH / 2 });
    }
  }
  return { keys, width: whiteCount * WHITE_KEY_WIDTH };
}

export interface PianoKeyboardProps {
  lowMidi: number;
  highMidi: number;
  expectedRight?: ReadonlySet<number>;
  expectedLeft?: ReadonlySet<number>;
  correct?: ReadonlySet<number>;
  wrong?: ReadonlySet<number>;
  onKeyPress?: (midi: number) => void;
}

export function PianoKeyboard({
  lowMidi,
  highMidi,
  expectedRight,
  expectedLeft,
  correct,
  wrong,
  onKeyPress,
}: PianoKeyboardProps) {
  const { keys, width } = layoutKeys(lowMidi, highMidi);
  const whiteKeys = keys.filter((k) => k.isWhite);
  const blackKeys = keys.filter((k) => !k.isWhite);

  const classFor = (midi: number, base: string) => {
    const classes = [base];
    if (correct?.has(midi)) classes.push('key-correct');
    else if (wrong?.has(midi)) classes.push('key-wrong');
    else if (expectedRight?.has(midi)) classes.push('key-expected-right');
    else if (expectedLeft?.has(midi)) classes.push('key-expected-left');
    return classes.join(' ');
  };

  return (
    <div className="piano-keyboard" style={{ width, height: WHITE_KEY_HEIGHT }}>
      {whiteKeys.map((key) => (
        <button
          key={key.midi}
          type="button"
          className={classFor(key.midi, 'piano-key white-key')}
          style={{ left: key.x, width: WHITE_KEY_WIDTH, height: WHITE_KEY_HEIGHT }}
          onClick={() => onKeyPress?.(key.midi)}
          aria-label={`key-${key.midi}`}
        />
      ))}
      {blackKeys.map((key) => (
        <button
          key={key.midi}
          type="button"
          className={classFor(key.midi, 'piano-key black-key')}
          style={{ left: key.x, width: BLACK_KEY_WIDTH, height: BLACK_KEY_HEIGHT }}
          onClick={() => onKeyPress?.(key.midi)}
          aria-label={`key-${key.midi}`}
        />
      ))}
    </div>
  );
}
