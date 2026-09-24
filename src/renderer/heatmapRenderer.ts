// src/renderer/heatmapRenderer.ts
// Renders a HeatmapGrid onto an OffscreenCanvas buffer.
// The buffer is drawn in UV / image-space coordinates so that the existing
// viewport transform (translate + scale) keeps heatmap perfectly aligned with
// the minimap on the main canvas.
//
// Rendering pipeline:
//   HeatmapGrid.normalized → pixel color via mode palette → OffscreenCanvas
//
// The caller blits the OffscreenCanvas to the main canvas AFTER the minimap
// and BEFORE player paths.

import type { HeatmapGrid, Hotspot, HeatmapMode } from '../hooks/useHeatmapGrid';

// ── Color palettes ────────────────────────────────────────────────────────────
// Each mode has a low→high density color ramp.
// Colors are in [r, g, b] 0-255.

interface ColorStop { t: number; r: number; g: number; b: number }

const PALETTES: Record<Exclude<HeatmapMode, 'none'>, ColorStop[]> = {
  traffic: [
    { t: 0.00, r:   0, g:   0, b:   0 },
    { t: 0.30, r:  10, g:  80, b: 140 },
    { t: 0.65, r:  30, g: 160, b: 220 },
    { t: 1.00, r:  56, g: 189, b: 248 },
  ],
  kills: [
    { t: 0.00, r:   0, g:   0, b:   0 },
    { t: 0.30, r: 120, g:  50, b:  20 },
    { t: 0.65, r: 220, g: 100, b:  40 },
    { t: 1.00, r: 251, g: 146, b:  60 },
  ],
  deaths: [
    { t: 0.00, r:   0, g:   0, b:   0 },
    { t: 0.30, r:  70, g:  30, b: 100 },
    { t: 0.65, r: 140, g:  60, b: 180 },
    { t: 1.00, r: 192, g: 110, b: 240 },
  ],
  storm: [
    { t: 0.00, r:   0, g:   0, b:   0 },
    { t: 0.40, r:  80, g:  70, b:  10 },
    { t: 0.75, r: 200, g: 170, b:  20 },
    { t: 1.00, r: 250, g: 204, b:  21 },
  ],
};

/** Max alpha for the densest cell, by mode. */
const MAX_ALPHA: Record<Exclude<HeatmapMode, 'none'>, number> = {
  traffic: 0.72,
  kills:   0.78,
  deaths:  0.72,
  storm:   0.80,
};

/** Low-density cutoff — cells below this normalized value are transparent. */
const LOW_CUTOFF = 0.04;

// ── Color sampling ────────────────────────────────────────────────────────────

function sampleColor(t: number, stops: ColorStop[]): [number, number, number] {
  if (t <= stops[0].t) return [stops[0].r, stops[0].g, stops[0].b];
  if (t >= stops[stops.length - 1].t) {
    const s = stops[stops.length - 1];
    return [s.r, s.g, s.b];
  }
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i].t) {
      const prev = stops[i - 1];
      const curr = stops[i];
      const f = (t - prev.t) / (curr.t - prev.t);
      return [
        Math.round(prev.r + f * (curr.r - prev.r)),
        Math.round(prev.g + f * (curr.g - prev.g)),
        Math.round(prev.b + f * (curr.b - prev.b)),
      ];
    }
  }
  const last = stops[stops.length - 1];
  return [last.r, last.g, last.b];
}

// ── Storm special rendering ───────────────────────────────────────────────────
// Storm data is sparse — render discrete influence rings rather than a
// continuous density field to communicate scarcity honestly.

export function renderStormPoints(
  ctx: CanvasRenderingContext2D,
  points: ReadonlyArray<{ u: number; v: number; event: string }>,
  imgW: number,
  imgH: number,
  alpha: number
): void {
  const stormPts = points.filter(p => p.event === 'KilledByStorm');
  if (stormPts.length === 0) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  for (const p of stormPts) {
    const cx = p.u * imgW;
    const cy = (1 - p.v) * imgH;

    // Outer soft ring
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, imgW * 0.025);
    grad.addColorStop(0,   'rgba(250,204,21,0.55)');
    grad.addColorStop(0.4, 'rgba(200,170,20,0.30)');
    grad.addColorStop(1,   'rgba(200,150,10,0.00)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, imgW * 0.025, 0, Math.PI * 2);
    ctx.fill();

    // Core dot
    ctx.fillStyle = 'rgba(255,220,30,0.90)';
    ctx.beginPath();
    ctx.arc(cx, cy, imgW * 0.004, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// ── Main renderer ─────────────────────────────────────────────────────────────

/**
 * Renders the heatmap grid to an OffscreenCanvas of size [grid.size x grid.size].
 * When blitted with ctx.imageSmoothingEnabled = true, the Canvas automatically
 * performs smooth bilinear interpolation across the terrain without blocky artifacts
 * or excessive memory overhead.
 */
export function renderHeatmapToOffscreen(
  grid: HeatmapGrid,
  mode: Exclude<HeatmapMode, 'none' | 'storm'>,
  _imgW?: number,
  _imgH?: number,
  existing?: OffscreenCanvas | null
): OffscreenCanvas {
  const { normalized, size } = grid;
  const oc = (existing && existing.width === size && existing.height === size)
    ? existing
    : new OffscreenCanvas(size, size);

  const octx = oc.getContext('2d')!;
  octx.clearRect(0, 0, size, size);

  const palette  = PALETTES[mode];
  const maxAlpha = MAX_ALPHA[mode];

  const imgData = octx.createImageData(size, size);
  const pix = imgData.data;

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      const n = normalized[row * size + col];
      if (n < LOW_CUTOFF) continue;

      const [r, g, b] = sampleColor(n, palette);
      const a = Math.round(maxAlpha * Math.pow(n, 0.70) * 255);

      const idx = (row * size + col) * 4;
      pix[idx]     = r;
      pix[idx + 1] = g;
      pix[idx + 2] = b;
      pix[idx + 3] = a;
    }
  }

  octx.putImageData(imgData, 0, 0);
  return oc;
}

// ── Hotspot annotation rendering ──────────────────────────────────────────────

export interface HotspotObstacle {
  x: number;
  y: number;
  radius: number;
  type?: 'event' | 'player' | 'hotspot';
}

const HOTSPOT_COLORS: Record<Exclude<HeatmapMode, 'none'>, string> = {
  traffic: 'rgba(56,189,248,0.95)',
  kills:   'rgba(251,146,60,0.95)',
  deaths:  'rgba(192,110,240,0.95)',
  storm:   'rgba(250,204,21,0.95)',
};

interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function rectsIntersect(a: Rect, b: Rect): boolean {
  return !(a.x1 < b.x0 || a.x0 > b.x1 || a.y1 < b.y0 || a.y0 > b.y1);
}

function distToRect(px: number, py: number, r: Rect): number {
  const dx = Math.max(r.x0 - px, 0, px - r.x1);
  const dy = Math.max(r.y0 - py, 0, py - r.y1);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Draws subtle hotspot annotations (diamond + label) on the main canvas with
 * intelligent multi-directional collision avoidance against event markers,
 * player positions, other hotspots, and map boundaries.
 */
export function renderHotspots(
  ctx: CanvasRenderingContext2D,
  hotspots: Hotspot[],
  mode: Exclude<HeatmapMode, 'none'>,
  imgW: number,
  imgH: number,
  viewportScale: number,
  minScale: number,
  obstacles: HotspotObstacle[] = []
): void {
  if (hotspots.length === 0 || viewportScale < minScale) return;

  const color = HOTSPOT_COLORS[mode];
  const diamondR = 5 / viewportScale;
  const fontSize = Math.max(8, 9 / viewportScale);

  ctx.save();
  ctx.font = `600 ${fontSize}px 'Inter', system-ui, sans-serif`;
  ctx.textBaseline = 'middle';

  const placedRects: Rect[] = [];

  for (const hs of hotspots) {
    const cx = hs.u * imgW;
    const cy = (1 - hs.v) * imgH;
    const label = `HOT ${String(hs.index).padStart(2, '0')}`;

    // Draw diamond anchor
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle   = 'rgba(10, 15, 20, 0.75)';
    ctx.lineWidth   = 1.2 / viewportScale;
    ctx.beginPath();
    ctx.moveTo(cx,            cy - diamondR);
    ctx.lineTo(cx + diamondR, cy);
    ctx.lineTo(cx,            cy + diamondR);
    ctx.lineTo(cx - diamondR, cy);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Dimensions
    const textW = ctx.measureText(label).width;
    const padV  = 2.5 / viewportScale;
    const padH  = 4 / viewportScale;
    const pillW = textW + padH * 2;
    const pillH = fontSize + padV * 2;

    // Define candidate placement offsets
    interface Candidate {
      x0: number;
      y0: number;
      baseCost: number;
      leader: boolean;
      leaderFrom?: { x: number; y: number };
      leaderTo?: { x: number; y: number };
    }

    const candidates: Candidate[] = [
      // 1. Right (default, adjacent, no leader needed)
      {
        x0: cx + diamondR + (3 / viewportScale),
        y0: cy - pillH / 2,
        baseCost: 0,
        leader: false,
      },
      // 2. Top (with short vertical leader line)
      {
        x0: cx - pillW / 2,
        y0: cy - diamondR - (8 / viewportScale) - pillH,
        baseCost: 10,
        leader: true,
        leaderFrom: { x: cx, y: cy - diamondR },
        leaderTo:   { x: cx, y: cy - diamondR - (8 / viewportScale) },
      },
      // 3. Bottom (with short vertical leader line)
      {
        x0: cx - pillW / 2,
        y0: cy + diamondR + (8 / viewportScale),
        baseCost: 15,
        leader: true,
        leaderFrom: { x: cx, y: cy + diamondR },
        leaderTo:   { x: cx, y: cy + diamondR + (8 / viewportScale) },
      },
      // 4. Left (adjacent, no leader)
      {
        x0: cx - diamondR - (3 / viewportScale) - pillW,
        y0: cy - pillH / 2,
        baseCost: 20,
        leader: false,
      },
      // 5. Top-Right diagonal
      {
        x0: cx + diamondR + (10 / viewportScale),
        y0: cy - diamondR - (6 / viewportScale) - pillH,
        baseCost: 30,
        leader: true,
        leaderFrom: { x: cx + diamondR * 0.7, y: cy - diamondR * 0.7 },
        leaderTo:   { x: cx + diamondR + (10 / viewportScale), y: cy - diamondR - (6 / viewportScale) },
      },
    ];

    // Score candidates: lower is better
    let bestCandidate = candidates[0];
    let minCost = Infinity;

    for (const cand of candidates) {
      const rect: Rect = {
        x0: cand.x0,
        y0: cand.y0,
        x1: cand.x0 + pillW,
        y1: cand.y0 + pillH,
      };

      let cost = cand.baseCost;

      // 1. Map boundary penalties
      if (rect.x0 < (4 / viewportScale) || rect.y0 < (4 / viewportScale) ||
          rect.x1 > (imgW - 4 / viewportScale) || rect.y1 > (imgH - 4 / viewportScale)) {
        cost += 10000;
      }

      // 2. Overlap with previously placed labels
      for (const placed of placedRects) {
        if (rectsIntersect(rect, placed)) {
          cost += 8000;
        }
      }

      // 3. Overlap with obstacles (event markers, player positions)
      for (const obs of obstacles) {
        const d = distToRect(obs.x, obs.y, rect);
        if (d < obs.radius) {
          cost += (obs.type === 'event' ? 5000 : 3000);
        }
      }

      if (cost < minCost) {
        minCost = cost;
        bestCandidate = cand;
      }
    }

    const chosenRect: Rect = {
      x0: bestCandidate.x0,
      y0: bestCandidate.y0,
      x1: bestCandidate.x0 + pillW,
      y1: bestCandidate.y0 + pillH,
    };
    placedRects.push(chosenRect);

    // Draw leader line if displaced
    if (bestCandidate.leader && bestCandidate.leaderFrom && bestCandidate.leaderTo) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth   = 1 / viewportScale;
      ctx.beginPath();
      ctx.moveTo(bestCandidate.leaderFrom.x, bestCandidate.leaderFrom.y);
      ctx.lineTo(bestCandidate.leaderTo.x,   bestCandidate.leaderTo.y);
      ctx.stroke();
      ctx.restore();
    }

    // Label pill background
    ctx.save();
    ctx.fillStyle   = 'rgba(10, 15, 22, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth   = 0.8 / viewportScale;
    ctx.beginPath();
    ctx.roundRect(chosenRect.x0, chosenRect.y0, pillW, pillH, 2 / viewportScale);
    ctx.fill();
    ctx.stroke();

    // Label text
    ctx.fillStyle = color;
    ctx.fillText(label, chosenRect.x0 + padH, chosenRect.y0 + pillH / 2);
    ctx.restore();
  }

  ctx.restore();
}
