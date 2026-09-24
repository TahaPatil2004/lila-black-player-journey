// src/hooks/useHeatmapGrid.ts
// Aggregates raw heatmap points into a density grid.
//
// Pipeline:
//   raw points → rawCountGrid → smoothedGrid (box blur) → normalizedGrid (0..1)
//
// IMPORTANT:
//   - rawCountGrid is preserved and never modified by smoothing.
//   - Smoothing is a pure display transform on a separate buffer.
//   - Normalization is per-map (relative to this dataset's max cell).
//   - All three buffers are returned so callers can access raw counts for readouts.
//
// Grid resolution: GRID_SIZE x GRID_SIZE in UV space [0,1].

import { useMemo } from 'react';
import type { NormalizedEvent } from '../types';

export type HeatmapMode = 'none' | 'traffic' | 'kills' | 'deaths' | 'storm';
export type HeatmapScope = 'all' | 'match';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Grid resolution for all-data heatmaps (larger dataset). */
const GRID_ALL   = 128;
/** Grid resolution for current-match heatmaps (smaller dataset). */
const GRID_MATCH = 64;
/** Box blur radius in grid cells. */
const BLUR_RADIUS = 2;

// ── Event category mapping ────────────────────────────────────────────────────

function eventMatchesMode(event: string, mode: HeatmapMode): boolean {
  switch (mode) {
    case 'traffic': return event === 'Position' || event === 'BotPosition';
    case 'kills':   return event === 'Kill'     || event === 'BotKill';
    case 'deaths':  return event === 'Killed'   || event === 'BotKilled';
    case 'storm':   return event === 'KilledByStorm';
    default:        return false;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HeatmapGrid {
  /** Raw per-cell event/sample count (never modified). */
  rawCounts: Float32Array;
  /** Spatially smoothed density values (display use only). */
  smoothed: Float32Array;
  /** Smoothed values normalized 0..1 against the global max (for rendering). */
  normalized: Float32Array;
  /** Grid size (both dimensions are equal). */
  size: number;
  /** Total raw count of matching points. */
  totalCount: number;
  /** Maximum raw cell count (useful for annotations). */
  maxRawCount: number;
}

export interface Hotspot {
  /** Grid cell column [0, size). */
  col: number;
  /** Grid cell row [0, size). */
  row: number;
  /** UV centroid. */
  u: number;
  v: number;
  /** Raw cell count at this location. */
  rawCount: number;
  /** 1-indexed label (HOT 01, HOT 02, HOT 03). */
  index: number;
}

// ── Grid aggregation ──────────────────────────────────────────────────────────

function buildRawGrid(
  points: ReadonlyArray<{ u: number; v: number; event: string }>,
  mode: HeatmapMode,
  size: number
): { rawCounts: Float32Array; totalCount: number } {
  const rawCounts = new Float32Array(size * size);
  let totalCount = 0;

  for (const p of points) {
    if (!eventMatchesMode(p.event, mode)) continue;
    // Clamp to [0, 1) then map to grid cell
    const col = Math.min(size - 1, Math.floor(Math.max(0, p.u) * size));
    const row = Math.min(size - 1, Math.floor(Math.max(0, 1 - p.v) * size)); // invert V (same as uvToCanvas)
    rawCounts[row * size + col] += 1;
    totalCount++;
  }

  return { rawCounts, totalCount };
}

/** Box blur: each cell becomes the average of its neighborhood. */
function boxBlur(src: Float32Array, size: number, radius: number): Float32Array {
  const tmp = new Float32Array(size * size);
  const dst = new Float32Array(size * size);

  // Horizontal pass
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let sum = 0;
      let count = 0;
      for (let dx = -radius; dx <= radius; dx++) {
        const c = col + dx;
        if (c >= 0 && c < size) {
          sum += src[row * size + c];
          count++;
        }
      }
      tmp[row * size + col] = sum / count;
    }
  }

  // Vertical pass
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      let sum = 0;
      let count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const r = row + dy;
        if (r >= 0 && r < size) {
          sum += tmp[r * size + col];
          count++;
        }
      }
      dst[row * size + col] = sum / count;
    }
  }

  return dst;
}

/**
 * 2-pass smoothing filter: preserves raw counts, produces a smooth, continuous
 * density field for display without over-blurring or creating false halos.
 */
function smoothGrid(src: Float32Array, size: number, radius: number): Float32Array {
  const pass1 = boxBlur(src, size, radius);
  return boxBlur(pass1, size, Math.max(1, radius - 1));
}

function normalize(src: Float32Array): { normalized: Float32Array; maxVal: number } {
  let maxVal = 0;
  for (let i = 0; i < src.length; i++) {
    if (src[i] > maxVal) maxVal = src[i];
  }
  if (maxVal === 0) return { normalized: new Float32Array(src.length), maxVal: 0 };
  const normalized = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) {
    normalized[i] = src[i] / maxVal;
  }
  return { normalized, maxVal };
}

// ── Hotspot detection (NMS) ───────────────────────────────────────────────────

/**
 * Greedy non-maximum suppression.
 * Picks the strongest cell, suppresses all cells within `suppressRadius`,
 * then repeats until `maxHotspots` found or no meaningful cells remain.
 *
 * Returns hotspots in canvas-row order (top of map first).
 */
function detectHotspots(
  rawCounts: Float32Array,
  size: number,
  maxHotspots: number,
  suppressRadius: number,
  minCountThreshold: number
): Hotspot[] {
  // Copy so we can suppress in-place without mutating rawCounts
  const scratch = new Float32Array(rawCounts);
  const hotspots: Hotspot[] = [];

  for (let h = 0; h < maxHotspots; h++) {
    // Find the current maximum
    let maxVal = 0;
    let maxIdx = -1;
    for (let i = 0; i < scratch.length; i++) {
      if (scratch[i] > maxVal) {
        maxVal = scratch[i];
        maxIdx = i;
      }
    }
    if (maxIdx === -1 || maxVal < minCountThreshold) break;

    const row = Math.floor(maxIdx / size);
    const col = maxIdx % size;

    // UV centroid of this grid cell
    const u = (col + 0.5) / size;
    const v = 1 - (row + 0.5) / size; // invert back

    hotspots.push({
      col, row, u, v,
      rawCount: rawCounts[maxIdx],
      index: h + 1,
    });

    // Suppress neighborhood
    for (let dr = -suppressRadius; dr <= suppressRadius; dr++) {
      for (let dc = -suppressRadius; dc <= suppressRadius; dc++) {
        const r = row + dr;
        const c = col + dc;
        if (r >= 0 && r < size && c >= 0 && c < size) {
          scratch[r * size + c] = 0;
        }
      }
    }
  }

  return hotspots;
}

// ── Public hook ───────────────────────────────────────────────────────────────

interface UseHeatmapGridResult {
  grid: HeatmapGrid | null;
  hotspots: Hotspot[];
}

/**
 * Builds a heatmap grid from allData points for the given mode.
 * Returns null when mode is 'none' or points array is empty.
 * Pure computation — fully memoized.
 */
export function useHeatmapGrid(
  points: ReadonlyArray<{ u: number; v: number; event: string }>,
  mode: HeatmapMode,
  scope: HeatmapScope
): UseHeatmapGridResult {
  return useMemo(() => {
    if (mode === 'none' || points.length === 0) {
      return { grid: null, hotspots: [] };
    }

    const size = scope === 'match' ? GRID_MATCH : GRID_ALL;
    const { rawCounts, totalCount } = buildRawGrid(points, mode, size);

    if (totalCount === 0) {
      return { grid: null, hotspots: [] };
    }

    const smoothed  = smoothGrid(rawCounts, size, BLUR_RADIUS);
    const { normalized, maxVal: _maxVal } = normalize(smoothed);

    // Raw max (from unsmoothed counts) for annotation readouts
    let maxRawCount = 0;
    for (let i = 0; i < rawCounts.length; i++) {
      if (rawCounts[i] > maxRawCount) maxRawCount = rawCounts[i];
    }

    const grid: HeatmapGrid = {
      rawCounts,
      smoothed,
      normalized,
      size,
      totalCount,
      maxRawCount,
    };

    // NMS hotspot detection
    // Suppress radius: ~8% of grid width; min count: 1% of max
    const suppressRadius  = Math.max(4, Math.round(size * 0.08));
    const minCount        = Math.max(1, maxRawCount * 0.01);
    const hotspots        = detectHotspots(rawCounts, size, 3, suppressRadius, minCount);

    return { grid, hotspots };
  }, [points, mode, scope]);
}

/**
 * Builds a heatmap grid from current-match NormalizedEvent data.
 * Uses the same pipeline as useHeatmapGrid.
 */
export function buildMatchGrid(
  events: ReadonlyArray<NormalizedEvent>,
  mode: HeatmapMode
): { grid: HeatmapGrid | null; hotspots: Hotspot[] } {
  if (mode === 'none' || events.length === 0) {
    return { grid: null, hotspots: [] };
  }

  const size = GRID_MATCH;
  const points = events.map(e => ({ u: e.uv.u, v: e.uv.v, event: e.event as string }));
  const { rawCounts, totalCount } = buildRawGrid(points, mode, size);

  if (totalCount === 0) {
    return { grid: null, hotspots: [] };
  }

  const smoothed  = smoothGrid(rawCounts, size, BLUR_RADIUS);
  const { normalized, maxVal: _maxVal } = normalize(smoothed);

  let maxRawCount = 0;
  for (let i = 0; i < rawCounts.length; i++) {
    if (rawCounts[i] > maxRawCount) maxRawCount = rawCounts[i];
  }

  const grid: HeatmapGrid = {
    rawCounts,
    smoothed,
    normalized,
    size,
    totalCount,
    maxRawCount,
  };

  const suppressRadius = Math.max(3, Math.round(size * 0.08));
  const minCount       = Math.max(1, maxRawCount * 0.01);
  const hotspots       = detectHotspots(rawCounts, size, 3, suppressRadius, minCount);

  return { grid, hotspots };
}
