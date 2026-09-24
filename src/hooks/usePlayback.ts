// src/hooks/usePlayback.ts
// RAF-based playback clock for match replay.
//
// Semantics for currentTime:
//   null             = STATIC mode (default, full telemetry shown)
//   0                = PLAYBACK mode at start
//   0 < t < duration = active playback position
//   duration         = playback at match end
//
// Reset always returns to null (static mode).

import { useCallback, useEffect, useRef, useState } from 'react';

export type PlaybackSpeed = 0.5 | 1 | 2 | 4 | 8;

export interface PlaybackState {
  currentTime: number | null;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  duration: number;
}

export interface PlaybackControls {
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

export function usePlayback(duration: number): PlaybackState & PlaybackControls {
  const [currentTime, setCurrentTime] = useState<number | null>(null);
  const [isPlaying, setIsPlaying]     = useState(false);
  const [speed, setSpeedState]        = useState<PlaybackSpeed>(1);

  // Refs for RAF — mutable so the loop always sees current values
  const isPlayingRef   = useRef(false);
  const speedRef       = useRef<PlaybackSpeed>(1);
  const durationRef    = useRef(duration);
  const currentTimeRef = useRef<number | null>(null);
  const rafRef         = useRef<number>(0);
  const lastTsRef      = useRef<number | null>(null);

  // Keep refs in sync with state
  useEffect(() => { durationRef.current = duration; }, [duration]);

  // ── RAF loop ──────────────────────────────────────────────────────────────

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    lastTsRef.current = null;
  }, []);

  const tick = useCallback((ts: number) => {
    if (!isPlayingRef.current) return;

    if (lastTsRef.current === null) {
      lastTsRef.current = ts;
    }
    const elapsed   = (ts - lastTsRef.current) / 1000; // seconds
    lastTsRef.current = ts;

    const prev = currentTimeRef.current ?? 0;
    const next = prev + elapsed * speedRef.current;
    const dur  = durationRef.current;

    if (next >= dur) {
      // Reached end — clamp and stop
      currentTimeRef.current = dur;
      setCurrentTime(dur);
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopRaf();
      return;
    }

    currentTimeRef.current = next;
    setCurrentTime(next);
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf]);

  const startRaf = useCallback(() => {
    stopRaf();
    lastTsRef.current = null;
    rafRef.current = requestAnimationFrame(tick);
  }, [stopRaf, tick]);

  // ── Controls ──────────────────────────────────────────────────────────────

  const play = useCallback(() => {
    const dur = durationRef.current;
    if (dur <= 0) return;

    // Determine start time
    let startTime: number;
    const ct = currentTimeRef.current;
    if (ct === null) {
      // Static mode → start from beginning
      startTime = 0;
    } else if (ct >= dur) {
      // At end → restart from beginning
      startTime = 0;
    } else {
      // Resume
      startTime = ct;
    }

    currentTimeRef.current = startTime;
    setCurrentTime(startTime);
    isPlayingRef.current = true;
    setIsPlaying(true);
    startRaf();
  }, [startRaf]);

  const pause = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    stopRaf();
  }, [stopRaf]);

  const reset = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    stopRaf();
    currentTimeRef.current = null;
    setCurrentTime(null);
  }, [stopRaf]);

  const seek = useCallback((t: number) => {
    const dur = durationRef.current;
    const clamped = Math.max(0, Math.min(dur, t));
    currentTimeRef.current = clamped;
    setCurrentTime(clamped);
    // Seeking while playing — reset the RAF timestamp so no jump
    if (isPlayingRef.current) {
      lastTsRef.current = null;
    }
  }, []);

  const setSpeed = useCallback((s: PlaybackSpeed) => {
    speedRef.current = s;
    setSpeedState(s);
  }, []);

  // ── Reset on match change ─────────────────────────────────────────────────

  const prevDuration = useRef(duration);
  useEffect(() => {
    if (prevDuration.current !== duration) {
      prevDuration.current = duration;
      isPlayingRef.current = false;
      setIsPlaying(false);
      stopRaf();
      currentTimeRef.current = null;
      setCurrentTime(null);
    }
  }, [duration, stopRaf]);

  // Cleanup on unmount
  useEffect(() => () => stopRaf(), [stopRaf]);

  return {
    currentTime,
    isPlaying,
    speed,
    duration,
    play,
    pause,
    reset,
    seek,
    setSpeed,
  };
}
