// src/renderer/eventRenderer.ts
// Pure Canvas event marker renderer.
// No React, no state. Receives prepared data and draws synchronously.
// Uses uvToCanvas() as the single coordinate source of truth.

import { uvToCanvas } from '../utils/coordinateTransform';
import type { NormalizedEvent, EventName } from '../types';

// ── Configuration ────────────────────────────────────────────────────────────

// Screen-space radius in CSS pixels within which same-type events are grouped
export const CLUSTER_RADIUS_PX = 18;

// Max icon size in CSS pixels (before scale inverse is applied)
const KILL_RADIUS   = 8;
const DEATH_RADIUS  = 8;
const STORM_RADIUS  = 9;
const LOOT_RADIUS   = 5;

// Colors — consistent with the app's dark tactical palette
const KILL_COLOR        = '#f43f5e'; // rose-500
const DEATH_COLOR       = '#a78bfa'; // violet-400
const STORM_COLOR       = '#fbbf24'; // amber-400
const LOOT_COLOR        = '#34d399'; // emerald-400

const OUTLINE_COLOR     = 'rgba(0,0,0,0.65)';
const OUTLINE_WIDTH     = 1.5;

// ── Types ────────────────────────────────────────────────────────────────────

export type VisualEventType = 'kill' | 'death' | 'storm' | 'loot';

/** One rendered cluster in image-space coordinates */
export interface EventCluster {
  type: VisualEventType;
  /** Image-space X (before viewport transform) */
  imgX: number;
  /** Image-space Y (before viewport transform) */
  imgY: number;
  count: number;
  events: NormalizedEvent[];
}

// ── Classification ────────────────────────────────────────────────────────────

export function classifyEvent(name: EventName): VisualEventType | null {
  switch (name as string) {
    case 'Kill':
    case 'BotKill':
      return 'kill';
    case 'Killed':
    case 'BotKilled':
      return 'death';
    case 'KilledByStorm':
      return 'storm';
    case 'Loot':
      return 'loot';
    default:
      return null;
  }
}

// ── Aggregation ───────────────────────────────────────────────────────────────

/**
 * Groups nearby same-type events into clusters.
 * Clustering is done in image-pixel space, then projected to screen-space for
 * the threshold check. This ensures the cluster radius is consistent across
 * all zoom levels at initial fit-scale.
 *
 * @param events    All events in the match
 * @param imgW      Natural image width
 * @param imgH      Natural image height
 * @param scale     Current absolute pixel scale (viewport.scale)
 */
export function buildClusters(
  events: NormalizedEvent[],
  imgW: number,
  imgH: number,
  scale: number
): EventCluster[] {
  const clusters: EventCluster[] = [];

  // The cluster threshold in IMAGE PIXEL space = screen px radius / current scale
  const thresholdImgPx = CLUSTER_RADIUS_PX / scale;

  for (const evt of events) {
    const type = classifyEvent(evt.event);
    if (!type) continue; // skip Position, BotPosition

    const { x, y } = uvToCanvas(evt.uv.u, evt.uv.v, imgW, imgH);

    // Find nearest cluster of same type within threshold
    let nearest: EventCluster | null = null;
    let nearestDist = Infinity;

    for (const c of clusters) {
      if (c.type !== type) continue;
      const dx = c.imgX - x;
      const dy = c.imgY - y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < thresholdImgPx && dist < nearestDist) {
        nearestDist = dist;
        nearest = c;
      }
    }

    if (nearest) {
      // Merge into existing cluster — update centroid (weighted average)
      const total = nearest.count + 1;
      nearest.imgX = (nearest.imgX * nearest.count + x) / total;
      nearest.imgY = (nearest.imgY * nearest.count + y) / total;
      nearest.count = total;
      nearest.events.push(evt);
    } else {
      clusters.push({ type, imgX: x, imgY: y, count: 1, events: [evt] });
    }
  }

  return clusters;
}

// ── Main entry point ──────────────────────────────────────────────────────────

export interface RenderEventsOptions {
  ctx: CanvasRenderingContext2D;
  clusters: EventCluster[];
  /** The absolute scale factor currently applied to the canvas context */
  absoluteScale: number;
}

export function renderEvents(opts: RenderEventsOptions): void {
  const { ctx, clusters, absoluteScale } = opts;

  for (const cluster of clusters) {
    drawCluster(ctx, cluster, absoluteScale);
  }
}

// ── Individual marker drawing ─────────────────────────────────────────────────

function drawCluster(
  ctx: CanvasRenderingContext2D,
  cluster: EventCluster,
  absoluteScale: number,
): void {
  const { type, imgX, imgY, count } = cluster;
  const inv = 1 / absoluteScale; // inverse scale to keep markers constant CSS size

  ctx.save();
  ctx.translate(imgX, imgY);
  ctx.scale(inv, inv); // marker is now drawn in CSS-pixel space

  switch (type) {
    case 'kill':   drawKillMarker(ctx, count);  break;
    case 'death':  drawDeathMarker(ctx, count); break;
    case 'storm':  drawStormMarker(ctx, count); break;
    case 'loot':   drawLootMarker(ctx, count);  break;
  }

  ctx.restore();
}

// ── Kill: Crimson crosshair circle + X ─────────────────────────────────────
function drawKillMarker(ctx: CanvasRenderingContext2D, count: number): void {
  const r = KILL_RADIUS;

  // Subtle glow only
  ctx.shadowColor = KILL_COLOR;
  ctx.shadowBlur = 4;

  // Circle background — semi-transparent fill
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(244, 63, 94, 0.15)';
  ctx.fill();

  // Dark outline for contrast, then color ring
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.stroke();
  ctx.lineWidth = 1.2;
  ctx.strokeStyle = KILL_COLOR;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // X icon — tight arms
  const arm = r * 0.52;
  ctx.lineWidth = 2;
  ctx.strokeStyle = KILL_COLOR;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-arm, -arm); ctx.lineTo(arm, arm);
  ctx.moveTo(arm, -arm);  ctx.lineTo(-arm, arm);
  ctx.stroke();

  if (count > 1) drawBadge(ctx, count, r, KILL_COLOR);
}

// ── Death: Purple skull ring ──────────────────────────────────────────────────
function drawDeathMarker(ctx: CanvasRenderingContext2D, count: number): void {
  const r = DEATH_RADIUS;

  ctx.shadowColor = DEATH_COLOR;
  ctx.shadowBlur = 4;

  // Circle background
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(167, 139, 250, 0.12)';
  ctx.fill();

  // Dark outline then color ring
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = DEATH_COLOR;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Inner filled dot — skull simplified
  ctx.beginPath();
  ctx.arc(0, -r * 0.1, r * 0.32, 0, Math.PI * 2);
  ctx.fillStyle = DEATH_COLOR;
  ctx.fill();

  // Two small dots (eye-sockets stylised)
  ctx.beginPath();
  ctx.arc(-r * 0.25, r * 0.35, r * 0.14, 0, Math.PI * 2);
  ctx.arc(r * 0.25, r * 0.35, r * 0.14, 0, Math.PI * 2);
  ctx.fillStyle = DEATH_COLOR;
  ctx.fill();

  if (count > 1) drawBadge(ctx, count, r, DEATH_COLOR);
}

// ── Storm: Amber compact diamond + bolt ─────────────────────────────────────
function drawStormMarker(ctx: CanvasRenderingContext2D, count: number): void {
  const r = STORM_RADIUS;

  ctx.shadowColor = STORM_COLOR;
  ctx.shadowBlur = 5;

  // Diamond shape
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.7, 0);
  ctx.lineTo(0, r);
  ctx.lineTo(-r * 0.7, 0);
  ctx.closePath();
  ctx.fillStyle = 'rgba(251, 191, 36, 0.15)';
  ctx.fill();

  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.stroke();
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = STORM_COLOR;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Lightning bolt — tight geometry inside diamond
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = STORM_COLOR;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(2, -r * 0.52);
  ctx.lineTo(-1.5, 0);
  ctx.lineTo(1, 0);
  ctx.lineTo(-2, r * 0.52);
  ctx.stroke();

  if (count > 1) drawBadge(ctx, count, r, STORM_COLOR);
}

// ── Loot: Emerald micro-diamond (very subtle) ─────────────────────────────────
function drawLootMarker(ctx: CanvasRenderingContext2D, count: number): void {
  const r = LOOT_RADIUS;
  const half = r * 0.9;

  ctx.shadowColor = LOOT_COLOR;
  ctx.shadowBlur = 2;

  // Rotated square — keep it very small
  ctx.save();
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = 'rgba(52, 211, 153, 0.15)';
  ctx.fillRect(-half / 2, -half / 2, half, half);
  ctx.lineWidth = OUTLINE_WIDTH - 0.5;
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.strokeRect(-half / 2, -half / 2, half, half);
  ctx.lineWidth = 0.9;
  ctx.strokeStyle = LOOT_COLOR;
  ctx.strokeRect(-half / 2, -half / 2, half, half);
  ctx.restore();

  ctx.shadowBlur = 0;

  // Tiny center dot
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = LOOT_COLOR;
  ctx.fill();

  if (count > 1) drawBadge(ctx, count, r + 1, LOOT_COLOR);
}

// ── Badge: small count pill ───────────────────────────────────────────────────
function drawBadge(
  ctx: CanvasRenderingContext2D,
  count: number,
  markerRadius: number,
  color: string
): void {
  const label = count > 99 ? '99+' : String(count);
  const badgeX = markerRadius * 0.7;
  const badgeY = -markerRadius * 0.7;
  const fontSize = 8;

  ctx.font = `bold ${fontSize}px Inter, sans-serif`;
  const textWidth = ctx.measureText(label).width;
  const pillW = Math.max(textWidth + 5, 14);
  const pillH = 12;

  // Pill background
  ctx.fillStyle = color;
  roundRect(ctx, badgeX - pillW / 2, badgeY - pillH / 2, pillW, pillH, 5);
  ctx.fill();

  // Badge text
  ctx.fillStyle = '#0a0b0f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, badgeX, badgeY);
}

// ── Utility: roundRect polyfill ───────────────────────────────────────────────
function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number
): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
}

// ── Hit-testing ───────────────────────────────────────────────────────────────

/**
 * Convert a CSS-space mouse position to image-space, accounting for the
 * current viewport transform (scale + offset).
 */
export function screenToImageSpace(
  screenX: number,
  screenY: number,
  viewportOffsetX: number,
  viewportOffsetY: number,
  viewportScale: number
): { imgX: number; imgY: number } {
  return {
    imgX: (screenX - viewportOffsetX) / viewportScale,
    imgY: (screenY - viewportOffsetY) / viewportScale,
  };
}

/**
 * Find the cluster under a given screen-space mouse position.
 * Hit radius is constant in CSS pixels regardless of zoom.
 */
export function hitTestClusters(
  clusters: EventCluster[],
  screenX: number,
  screenY: number,
  viewportOffsetX: number,
  viewportOffsetY: number,
  viewportScale: number
): EventCluster | null {
  const { imgX, imgY } = screenToImageSpace(
    screenX, screenY,
    viewportOffsetX, viewportOffsetY, viewportScale
  );

  // Hit radius in image pixels (constant ~14px on screen)
  const hitRadiusImg = 14 / viewportScale;

  let best: EventCluster | null = null;
  let bestDist = Infinity;

  for (const c of clusters) {
    const dx = c.imgX - imgX;
    const dy = c.imgY - imgY;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < hitRadiusImg && dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }

  return best;
}
