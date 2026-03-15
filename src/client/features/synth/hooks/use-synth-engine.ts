import { useRef, useEffect, useCallback } from 'react';
import { AudioEngine } from '../lib/audio-engine';

/**
 * React wrapper hook for AudioEngine (TAS-65).
 *
 * v5 Pattern: The AudioEngine itself is a vanilla TS class, NOT a React
 * component. This hook only manages its lifecycle (create/dispose) and
 * exposes a stable ref. All hot-path note events go directly to the
 * AudioEngine instance via ref — never through React state.
 */
export function useSynthEngine() {
  const engineRef = useRef<AudioEngine | null>(null);

  // Lazy init — create once
  if (!engineRef.current) {
    engineRef.current = new AudioEngine();
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      engineRef.current?.dispose();
    };
  }, []);

  /**
   * Start the audio context — must be called from a user gesture
   * (click/keydown) to satisfy browser autoplay policy.
   */
  const startAudio = useCallback(async () => {
    await engineRef.current?.start();
  }, []);

  return {
    engine: engineRef.current,
    startAudio,
    isStarted: engineRef.current?.isStarted() ?? false,
  };
}
