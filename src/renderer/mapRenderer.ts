// src/renderer/mapRenderer.ts
// Orchestrator — calls path renderer and event renderer in the correct order.
// All layers share the SAME canvas transform so zoom/pan stays in sync.

import { uvToCanvas } from '../utils/coordinateTransform';
import { renderEvents, buildClusters } from './eventRenderer';
import { renderHotspots, renderStormPoints } from './heatmapRenderer';
import type { HotspotObstacle } from './heatmapRenderer';
import type { NormalizedEvent } from '../types';
import type { EventCluster } from './eventRenderer';
import type { HeatmapMode, Hotspot } from '../hooks/useHeatmapGrid';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Viewport {
  offsetX: number;
  offsetY: number;
  scale: number;
}

export interface RenderOptions {
  ctx: CanvasRenderingContext2D;
  canvasWidth: number;
  canvasHeight: number;
  dpr: number;
  image: HTMLImageElement;
  events: NormalizedEvent[];
  viewport: Viewport;
  focusUserId?: string | null;
  /**
   * Current playback position in seconds.
   * null = STATIC mode (render all events, full paths — identical to pre-playback behavior).
   * number = PLAYBACK mode (slice paths and events to relativeSeconds <= currentTime).
   */
  currentTime?: number | null;
  /**
   * Pre-rendered heatmap OffscreenCanvas (null/undefined = no heatmap).
   * Rendered in image-space coordinates — the viewport transform keeps it aligned.
   */
  heatmapCanvas?: OffscreenCanvas | null;
  /** Storm raw points for discrete ring rendering. */
  stormPoints?: ReadonlyArray<{ u: number; v: number; event: string }> | null;
  /** Active heatmap mode (used for storm rendering path and hotspot color). */
  heatmapMode?: HeatmapMode;
  /** Heatmap layer opacity transition alpha [0..1] (default 1.0). */
  heatmapAlpha?: number;
  /** Path alpha override when heatmap is active (1.0 = unchanged). */
  pathAlpha?: number;
  /** Selected-player path alpha override (1.0 = unchanged). */
  selectedPathAlpha?: number;
  /** Hotspots to annotate. */
  hotspots?: Hotspot[];
  /** Minimum viewport scale before hotspot labels are suppressed. */
  hotspotMinScale?: number;
  /** Receives the clusters built this frame for hit-testing in MapCanvas */
  onClustersBuilt?: (clusters: EventCluster[]) => void;
}


// ── Constants ─────────────────────────────────────────────────────────────────

const HUMAN_COLOR = 'rgba(56, 189, 248, 0.85)';
const BOT_COLOR   = 'rgba(251, 146, 60, 0.75)';
const HUMAN_WIDTH = 2.5;
const BOT_WIDTH   = 1.8;
const DOT_RADIUS  = 4;

// ── Main render entry ─────────────────────────────────────────────────────────

export function renderFrame(opts: RenderOptions): void {
  const {
    ctx, canvasWidth, canvasHeight, dpr, image, events, viewport, focusUserId,
    currentTime, onClustersBuilt,
    heatmapCanvas, stormPoints, heatmapMode,
    heatmapAlpha = 1,
    pathAlpha = 1, selectedPathAlpha = 1,
    hotspots, hotspotMinScale = 0,
  } = opts;
  const playback = currentTime !== null && currentTime !== undefined;
  const hasHeatmap = (heatmapCanvas != null || (heatmapMode === 'storm' && stormPoints && stormPoints.length > 0));

  // ── 1. Clear backing store ────────────────────────────────────────────────
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvasWidth * dpr, canvasHeight * dpr);

  // ── 2. Apply transform: DPR → Viewport (absolute offsets from useZoomPan) ─
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.translate(viewport.offsetX, viewport.offsetY);
  ctx.scale(viewport.scale, viewport.scale);

  // ── 3. Draw minimap ───────────────────────────────────────────────────────
  ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight);

  // ── 3b. Heatmap layer (BEFORE paths so paths draw on top) ──────────────────────
  if (heatmapCanvas && heatmapAlpha > 0.01) {
    ctx.save();
    ctx.globalAlpha = heatmapAlpha;
    // Hardware bilinear smoothing across the minimap terrain eliminates blocky square artifacts
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(heatmapCanvas, 0, 0, image.naturalWidth, image.naturalHeight);
    ctx.restore();
  }
  // Storm: discrete ring rendering (sparse — rendered directly, no grid)
  if (heatmapMode === 'storm' && stormPoints && stormPoints.length > 0 && heatmapAlpha > 0.01) {
    renderStormPoints(ctx, stormPoints, image.naturalWidth, image.naturalHeight, heatmapAlpha);
  }

  // ── 4. Draw player paths (with optional alpha dim when heatmap active) ─────────
  const pathsByUser = buildPathsByUser(
    events,
    image.naturalWidth,
    image.naturalHeight,
    focusUserId,
    playback ? (currentTime as number) : null
  );
  for (const [userId, { points, entityType }] of pathsByUser) {
    const isSelected = focusUserId != null && userId === focusUserId;
    const alpha = hasHeatmap
      ? (isSelected ? (1 - (1 - selectedPathAlpha) * heatmapAlpha) : (1 - (1 - pathAlpha) * heatmapAlpha))
      : 1;
    drawPath(ctx, points, entityType, viewport.scale, alpha);
  }

  // ── 4b. Current-position dots (playback only) ─────────────────────────────
  if (playback) {
    for (const [, { points, entityType }] of pathsByUser) {
      if (points.length === 0) continue;
      drawCurrentPositionDot(ctx, points[points.length - 1], entityType, viewport.scale);
    }
  }

  // ── 5. Draw event markers (gated to occurred events during playback) ───────
  const markerEvents = playback
    ? events.filter((e) => e.relativeSeconds <= (currentTime as number))
    : events;
  const clusters = buildClusters(markerEvents, image.naturalWidth, image.naturalHeight, viewport.scale);
  renderEvents({ ctx, clusters, absoluteScale: viewport.scale });
  onClustersBuilt?.(clusters);

  // ── 6. Hotspot annotations (above events, with collision avoidance) ───────
  if (hotspots && hotspots.length > 0 && heatmapMode && heatmapMode !== 'none' && heatmapMode !== 'storm') {
    const obstacles: HotspotObstacle[] = [];
    for (const cl of clusters) {
      obstacles.push({ x: cl.imgX, y: cl.imgY, radius: 14 / viewport.scale, type: 'event' });
    }
    if (playback) {
      for (const [, { points }] of pathsByUser) {
        if (points.length > 0) {
          const pt = points[points.length - 1];
          obstacles.push({ x: pt.x, y: pt.y, radius: 8 / viewport.scale, type: 'player' });
        }
      }
    }

    renderHotspots(
      ctx, hotspots, heatmapMode as Exclude<HeatmapMode, 'none'>,
      image.naturalWidth, image.naturalHeight,
      viewport.scale, hotspotMinScale,
      obstacles
    );
  }

  ctx.restore();
}


// ── Path helpers ──────────────────────────────────────────────────────────────

interface TimedSample {
  t: number;
  x: number;
  y: number;
}

interface UserPath {
  points: Array<{ x: number; y: number }>;
  entityType: 'human' | 'bot';
}

function buildPathsByUser(
  events: NormalizedEvent[],
  imgW: number,
  imgH: number,
  focusUserId?: string | null,
  /** null = static mode (include all samples); number = include samples where relativeSeconds <= cutoff */
  timeCutoff?: number | null
): Map<string, UserPath> {
  const userMap = new Map<string, { entityType: 'human' | 'bot'; samples: TimedSample[] }>();

  for (const evt of events) {
    if (evt.event !== 'Position' && evt.event !== 'BotPosition') continue;
    if (focusUserId != null && evt.userId !== focusUserId) continue;

    const pt = uvToCanvas(evt.uv.u, evt.uv.v, imgW, imgH);
    let entry = userMap.get(evt.userId);
    if (!entry) {
      entry = { entityType: evt.entityType, samples: [] };
      userMap.set(evt.userId, entry);
    }
    entry.samples.push({ t: evt.relativeSeconds, x: pt.x, y: pt.y });
  }

  const result = new Map<string, UserPath>();

  for (const [userId, { entityType, samples }] of userMap) {
    if (samples.length === 0) continue;

    // Static mode: render complete recorded path without time cutoff
    if (timeCutoff === null || timeCutoff === undefined) {
      result.set(userId, {
        points: samples.map((s) => ({ x: s.x, y: s.y })),
        entityType,
      });
      continue;
    }

    // Playback mode: timeCutoff is a number (including 0)
    samples.sort((a, b) => a.t - b.t);
    const t = timeCutoff;

    // Before first recorded sample: entity not yet active
    if (t < samples[0].t) {
      result.set(userId, { points: [], entityType });
      continue;
    }

    // At or beyond last sample: entity completed journey
    if (t >= samples[samples.length - 1].t) {
      result.set(userId, {
        points: samples.map((s) => ({ x: s.x, y: s.y })),
        entityType,
      });
      continue;
    }

    // Binary search for sample segment [i, i+1] where samples[i].t <= t < samples[i+1].t
    let low = 0;
    let high = samples.length - 2;
    let i = 0;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (samples[mid].t <= t) {
        i = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    const s0 = samples[i];
    const s1 = samples[i + 1];
    const dt = s1.t - s0.t;
    const frac = dt > 0 ? Math.max(0, Math.min(1, (t - s0.t) / dt)) : 0;

    const interpX = s0.x + (s1.x - s0.x) * frac;
    const interpY = s0.y + (s1.y - s0.y) * frac;

    const points: Array<{ x: number; y: number }> = samples.slice(0, i + 1).map((s) => ({ x: s.x, y: s.y }));
    points.push({ x: interpX, y: interpY });

    result.set(userId, { points, entityType });
  }

  return result;
}

function drawPath(
  ctx: CanvasRenderingContext2D,
  points: Array<{ x: number; y: number }>,
  entityType: 'human' | 'bot',
  scale: number,
  alpha = 1
): void {
  if (points.length === 0) return;
  const color = entityType === 'human' ? HUMAN_COLOR : BOT_COLOR;
  const baseW  = entityType === 'human' ? HUMAN_WIDTH : BOT_WIDTH;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = baseW / scale;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (entityType === 'bot') {
    ctx.setLineDash([6 / scale, 4 / scale]);
  } else {
    ctx.setLineDash([]);
  }

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  ctx.stroke();

  ctx.setLineDash([]);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(points[0].x, points[0].y, DOT_RADIUS / scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}


/** Draws a subtle "current position" indicator at the leading recorded sample during playback. */
function drawCurrentPositionDot(
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  entityType: 'human' | 'bot',
  scale: number
): void {
  const color = entityType === 'human' ? HUMAN_COLOR : BOT_COLOR;
  const radius = (DOT_RADIUS + 2) / scale;

  ctx.save();
  // Outer ring
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5 / scale;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  // Inner fill
  ctx.fillStyle = color;
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(point.x, point.y, (DOT_RADIUS - 1) / scale, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
