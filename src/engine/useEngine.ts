import { useSyncExternalStore } from 'react';
import { engine, type EngineState } from './practiceEngine';

export function useEngineState<T>(selector: (state: EngineState) => T): T {
  return useSyncExternalStore(engine.subscribe, () => selector(engine.getSnapshot()));
}
