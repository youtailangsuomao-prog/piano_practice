import { BLACK_KEY_HEIGHT, BLACK_KEY_WIDTH, WHITE_KEY_HEIGHT, WHITE_KEY_WIDTH, layoutKeys } from '../lib/keyboardLayout';

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
