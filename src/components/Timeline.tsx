// src/components/Timeline.tsx
// Playback timeline bar — playback controls, scrubber, event ticks.
// Rendered below the map canvas. Does NOT touch the canvas transform.

import { useRef, useMemo, useCallback } from 'react';
import type { PlaybackSpeed } from '../hooks/usePlayback';
import type { NormalizedEvent } from '../types';

interface TimelineProps {
  // Playback state
  currentTime: number | null;
  isPlaying: boolean;
  speed: PlaybackSpeed;
  duration: number;
  // Controls
  play: () => void;
  pause: () => void;
  reset: () => void;
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
  // Event data (for tick marks) — already filtered by player + visibility
  visibleEvents: NormalizedEvent[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(seconds: number): string {
  const s = Math.floor(seconds);
  const m = Math.floor(s / 60);
  const ss = s % 60;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4, 8];

function speedLabel(s: PlaybackSpeed): string {
  return s === 0.5 ? '½×' : `${s}×`;
}

// Event category → color mapping (matches CSS variables)
function eventTickColor(event: string): string {
  if (event === 'Kill'   || event === 'BotKill')    return 'var(--color-kill)';
  if (event === 'Killed' || event === 'BotKilled')  return 'var(--color-death)';
  if (event === 'Loot')                              return 'var(--color-loot)';
  if (event === 'KilledByStorm')                     return 'var(--color-storm)';
  return 'transparent';
}

function isMarkerEvent(event: string): boolean {
  return (
    event === 'Kill'     || event === 'BotKill'   ||
    event === 'Killed'   || event === 'BotKilled' ||
    event === 'Loot'     || event === 'KilledByStorm'
  );
}

// ── Tick data builder ─────────────────────────────────────────────────────────

interface EventTick {
  pct: number;   // 0..1 position on track
  color: string;
  // dominant category at this position (for stacking avoidance)
  priority: number; // kills=0, deaths=1, loot=2, storm=3
}

function buildTicks(events: NormalizedEvent[], duration: number): EventTick[] {
  if (duration <= 0) return [];

  // Group events by rounded timestamp (nearest 0.25s bucket) to avoid stacking
  const buckets = new Map<number, { color: string; priority: number }>();

  for (const e of events) {
    if (!isMarkerEvent(e.event as string)) continue;
    const bucket = Math.round(e.relativeSeconds * 4) / 4; // 0.25s resolution
    const color = eventTickColor(e.event as string);
    const priority =
      e.event === 'Kill'   || e.event === 'BotKill'   ? 0 :
      e.event === 'Killed' || e.event === 'BotKilled' ? 1 :
      e.event === 'Loot'                               ? 2 : 3;

    const existing = buckets.get(bucket);
    if (!existing || priority < existing.priority) {
      buckets.set(bucket, { color, priority });
    }
  }

  return Array.from(buckets.entries()).map(([t, { color, priority }]) => ({
    pct: t / duration,
    color,
    priority,
  }));
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Timeline({
  currentTime,
  isPlaying,
  speed,
  duration,
  play,
  pause,
  reset,
  seek,
  setSpeed,
  visibleEvents,
}: TimelineProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const displayTime = currentTime ?? 0;
  const fillPct = duration > 0 ? Math.min(1, displayTime / duration) : 0;

  // Build event ticks from the already-filtered visible events
  const ticks = useMemo(
    () => buildTicks(visibleEvents, duration),
    [visibleEvents, duration]
  );

  // ── Scrubber interaction ──────────────────────────────────────────────────

  const computeSeek = useCallback((clientX: number): number => {
    const track = trackRef.current;
    if (!track || duration <= 0) return 0;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return pct * duration;
  }, [duration]);

  // Click/drag scrubbing
  const handleTrackPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    seek(computeSeek(e.clientX));
    // If was playing, pause during scrub and re-start on pointer up
    if (isPlaying) pause();
  }, [computeSeek, seek, isPlaying, pause]);

  const handleTrackPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons === 0) return;
    seek(computeSeek(e.clientX));
  }, [computeSeek, seek]);

  // ── Play / Pause toggle ───────────────────────────────────────────────────

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  }, [isPlaying, play, pause]);

  // ── Keyboard on scrubber ─────────────────────────────────────────────────

  const handleTrackKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!duration) return;
    const step = duration * 0.01; // 1% per arrow key
    if (e.key === 'ArrowRight') { e.preventDefault(); seek(Math.min(duration, displayTime + step)); }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); seek(Math.max(0, displayTime - step)); }
    if (e.key === 'Home')       { e.preventDefault(); seek(0); }
    if (e.key === 'End')        { e.preventDefault(); seek(duration); }
    if (e.key === ' ')          { e.preventDefault(); handlePlayPause(); }
  }, [duration, displayTime, seek, handlePlayPause]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="timeline-bar" aria-label="Match playback timeline">

      {/* Left: transport controls */}
      <div className="timeline-transport">
        <button
          className={`tl-btn tl-btn--play${isPlaying ? ' is-playing' : ''}`}
          onClick={handlePlayPause}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          aria-label={isPlaying ? 'Pause' : 'Play'}
          disabled={duration <= 0}
        >
          {isPlaying ? <PauseIcon /> : <PlayIcon />}
        </button>

        <button
          className="tl-btn tl-btn--reset"
          onClick={reset}
          title="Reset to full view"
          aria-label="Reset playback"
          disabled={currentTime === null && !isPlaying}
        >
          <ResetIcon />
        </button>
      </div>

      {/* Center: time + scrubber */}
      <div className="timeline-center">
        <span className="tl-time tl-time--current" aria-label="Current time">
          {formatTime(displayTime)}
        </span>

        {/* Scrubber track */}
        <div
          ref={trackRef}
          className="tl-track"
          role="slider"
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={displayTime}
          aria-valuetext={formatTime(displayTime)}
          aria-label="Playback position"
          tabIndex={duration > 0 ? 0 : -1}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onKeyDown={handleTrackKeyDown}
        >
          {/* Fill */}
          <div
            className="tl-track-fill"
            style={{ width: `${fillPct * 100}%` }}
          />

          {/* Event ticks */}
          {ticks.map((tick, i) => (
            <div
              key={i}
              className="tl-tick"
              style={{
                left: `${tick.pct * 100}%`,
                background: tick.color,
              }}
            />
          ))}

          {/* Thumb */}
          <div
            className="tl-thumb"
            style={{ left: `${fillPct * 100}%` }}
          />
        </div>

        <span className="tl-time tl-time--total" aria-label="Total duration">
          {formatTime(duration)}
        </span>
      </div>

      {/* Right: speed selector */}
      <div className="timeline-speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            className={`tl-speed-btn${speed === s ? ' is-active' : ''}`}
            onClick={() => setSpeed(s)}
            title={`${speedLabel(s)} playback speed`}
            aria-pressed={speed === s}
          >
            {speedLabel(s)}
          </button>
        ))}
      </div>

    </div>
  );
}

// ── SVG Icon components ───────────────────────────────────────────────────────

function PlayIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <polygon points="2,1 11,6 2,11" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <rect x="1.5" y="1" width="3.5" height="10" rx="1" fill="currentColor" />
      <rect x="7" y="1" width="3.5" height="10" rx="1" fill="currentColor" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden>
      <path
        d="M6 2a4 4 0 1 0 3.46 2"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
      <polygon points="9.5,1 11.5,4 7.5,4" fill="currentColor" />
    </svg>
  );
}
