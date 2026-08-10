import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PianoInput, PianoInputStatus, PianoNoteEvent, PianoNoteListener } from '../lib/webMidiInput';

export function usePianoInput() {
  const inputRef = useRef<PianoInput>();
  if (!inputRef.current) inputRef.current = new PianoInput();

  const [status, setStatus] = useState<PianoInputStatus>(
    inputRef.current.isSupported() ? 'disconnected' : 'unsupported',
  );
  const [deviceNames, setDeviceNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(async () => {
    setStatus('connecting');
    setError(null);
    try {
      const names = await inputRef.current!.connect();
      setDeviceNames(names);
      setStatus('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  }, []);

  useEffect(() => () => inputRef.current?.disconnect(), []);

  const subscribe = useCallback((listener: PianoNoteListener) => inputRef.current!.onNote(listener), []);

  return useMemo(
    () => ({ status, deviceNames, error, connect, subscribe }),
    [status, deviceNames, error, connect, subscribe],
  );
}

export type { PianoNoteEvent };
