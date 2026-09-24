// src/components/MapCanvas.tsx
// React wrapper around the HTML5 Canvas.

import { useEffect, useRef, useState, useCallback } from 'react';
import { renderFrame } from '../renderer/mapRenderer';
import { renderHeatmapToOffscreen } from '../renderer/heatmapRenderer';
import { useZoomPan } from '../hooks/useZoomPan';
import { useEventTooltip } from '../hooks/useEventTooltip';
import { EventTooltip } from './EventTooltip';
import type { NormalizedEvent } from '../types';
import type { EventCluster } from '../renderer/eventRenderer';
import type { HeatmapGrid, HeatmapMode, Hotspot } from '../hooks/useHeatmapGrid';

interface MapCanvasProps {
  image: HTMLImageElement | null;
  events: NormalizedEvent[];
  focusUserId?: string | null;
  /** null = static mode; number = playback position in seconds */
  currentTime?: number | null;
  // ── Heatmap ──────────────────────────────────────────────────────────────
  heatmapMode?: HeatmapMode;
  heatmapGrid?: HeatmapGrid | null;
  /** Storm raw points for discrete ring rendering */
  stormPoints?: ReadonlyArray<{ u: number; v: number; event: string }> | null;
  hotspots?: Hotspot[];
}

/** Path alpha when heatmap is active */
const HEATMAP_PATH_ALPHA     = 0.35;
const HEATMAP_SEL_PATH_ALPHA = 0.85;
/** Transition duration in ms */
const OPACITY_TRANSITION_MS  = 220;

export function MapCanvas({
  image, events, focusUserId, currentTime,
  heatmapMode = 'none', heatmapGrid, stormPoints, hotspots,
}: MapCanvasProps) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number>(0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // ── Offscreen heatmap buffer ────────────────────────────────────────────
  // Rebuilt only when heatmapGrid/mode/image changes — not every frame.
  const offscreenRef   = useRef<OffscreenCanvas | null>(null);
  const opacRafRef     = useRef<number>(0);
  const lastOpacTsRef  = useRef<number | null>(null);
  // Mutable opacity value read by the render loop each frame
  const heatOpacityRef = useRef(0);
  const heatTargetRef  = useRef(0);

  // Clusters from the last rendered frame — used for hit-testing without re-renders
  const clustersRef     = useRef<EventCluster[]>([]);
  const onClustersBuilt = useCallback((clusters: EventCluster[]) => {
    clustersRef.current = clusters;
  }, []);

  const {
    viewport,
    resetViewport,
    onMouseDown,
    onMouseMove: onPanMove,
    onMouseUp,
    onMouseLeave: onPanLeave,
  } = useZoomPan(canvasRef, size.width, size.height, image?.naturalWidth ?? 0, image?.naturalHeight ?? 0);

  const { tooltip, onMouseMove: onHoverMove, onMouseLeave: onHoverLeave } = useEventTooltip();

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    onPanMove(e);
    onHoverMove(e, clustersRef.current, viewport);
  }, [onPanMove, onHoverMove, viewport]);

  const handleMouseLeave = useCallback(() => {
    onPanLeave();
    onHoverLeave();
  }, [onPanLeave, onHoverLeave]);

  // ── Resize observer ─────────────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width, height });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // ── Rebuild offscreen heatmap buffer ────────────────────────────────────
  useEffect(() => {
    if (!image || heatmapMode === 'none' || heatmapMode === 'storm' || !heatmapGrid) {
      offscreenRef.current = null;
      return;
    }
    offscreenRef.current = renderHeatmapToOffscreen(
      heatmapGrid,
      heatmapMode as Exclude<HeatmapMode, 'none' | 'storm'>,
      image.naturalWidth,
      image.naturalHeight,
      offscreenRef.current
    );
  }, [heatmapGrid, heatmapMode, image]);

  // ── Stable render function ───────────────────────────────────────────────
  const doRender = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx || !image || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;

    const activeHeatmap = heatmapMode !== 'none';

    renderFrame({
      ctx,
      canvasWidth: size.width,
      canvasHeight: size.height,
      dpr,
      image,
      events,
      viewport,
      focusUserId,
      currentTime,
      heatmapCanvas: offscreenRef.current,
      stormPoints,
      heatmapMode,
      heatmapAlpha:      heatOpacityRef.current,
      pathAlpha:         activeHeatmap ? HEATMAP_PATH_ALPHA     : 1,
      selectedPathAlpha: activeHeatmap ? HEATMAP_SEL_PATH_ALPHA : 1,
      hotspots,
      hotspotMinScale: 0,
      onClustersBuilt,
    });
  }, [image, events, viewport, focusUserId, currentTime, heatmapMode, stormPoints, hotspots, size, onClustersBuilt]);

  // ── Scheduled render ─────────────────────────────────────────────────────
  const scheduleRender = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = requestAnimationFrame(doRender);
  }, [doRender]);

  // ── Opacity transition RAF ───────────────────────────────────────────────
  // Runs independently to drive smooth heatmap fade in/out.
  // scheduleRender is called each step so the canvas redraws with updated alpha.
  // (heatOpacityRef is currently informational; actual opacity comes from
  //  the offscreen being present or not in renderFrame. For future use with
  //  per-layer globalAlpha, the ref is wired.)
  useEffect(() => {
    heatTargetRef.current = heatmapMode !== 'none' ? 1 : 0;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (opacRafRef.current) cancelAnimationFrame(opacRafRef.current);
    lastOpacTsRef.current = null;

    if (reducedMotion) {
      heatOpacityRef.current = heatTargetRef.current;
      scheduleRender();
      return;
    }

    const step = (ts: number) => {
      if (lastOpacTsRef.current === null) lastOpacTsRef.current = ts;
      const elapsed = ts - lastOpacTsRef.current;
      lastOpacTsRef.current = ts;
      const target = heatTargetRef.current;
      const dir    = target > heatOpacityRef.current ? 1 : -1;
      const delta  = (elapsed / OPACITY_TRANSITION_MS) * dir;
      const next   = heatOpacityRef.current + delta;
      heatOpacityRef.current = dir > 0 ? Math.min(target, next) : Math.max(target, next);
      scheduleRender();
      if (Math.abs(heatOpacityRef.current - target) > 0.005) {
        opacRafRef.current = requestAnimationFrame(step);
      }
    };
    opacRafRef.current = requestAnimationFrame(step);
    return () => { if (opacRafRef.current) cancelAnimationFrame(opacRafRef.current); };
  }, [heatmapMode, scheduleRender]);

  // ── Main render trigger ──────────────────────────────────────────────────
  useEffect(() => {
    scheduleRender();
    return () => { if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current); };
  }, [scheduleRender]);

  const dpr = window.devicePixelRatio || 1;

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden' }}
    >
      <canvas
        ref={canvasRef}
        width={size.width * dpr}
        height={size.height * dpr}
        style={{
          width: size.width,
          height: size.height,
          display: 'block',
          cursor: tooltip ? 'default' : 'grab',
        }}
        onMouseDown={onMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={handleMouseLeave}
      />

      {/* Reset zoom button */}
      <button
        onClick={resetViewport}
        title="Reset zoom"
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          background: 'rgba(15,15,20,0.85)',
          color: '#e2e8f0',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 6,
          padding: '4px 10px',
          fontSize: 12,
          cursor: 'pointer',
          fontFamily: 'inherit',
          zIndex: 10,
        }}
      >
        Reset View
      </button>

      {/* Event tooltip */}
      {tooltip && <EventTooltip data={tooltip} />}
    </div>
  );
}
