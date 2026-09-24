// src/hooks/useEventTooltip.ts
// Manages hover hit-testing and tooltip state.
// Computes tooltip content from a hovered EventCluster.
// Semantics are accurate to the telemetry: never infer victim identity.

import { useState, useCallback, useRef } from 'react';
import { hitTestClusters, type EventCluster, type VisualEventType } from '../renderer/eventRenderer';
import type { Viewport } from '../renderer/mapRenderer';

export interface TooltipData {
  screenX: number;
  screenY: number;
  title: string;
  lines: string[];
}

function formatTime(relSec: number): string {
  const m = Math.floor(relSec / 60);
  const s = Math.floor(relSec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function typeTitle(type: VisualEventType, rawEvent?: string): string {
  switch (type) {
    case 'kill':
      // BotKill vs Kill — distinguish in title when we have a single event
      if (rawEvent === 'BotKill') return 'Bot Kill';
      return 'Kill';
    case 'death':
      if (rawEvent === 'BotKilled') return 'Killed by Bot';
      return 'Death';
    case 'storm': return 'Storm Death';
    case 'loot':  return 'Loot';
  }
}

function buildTooltip(cluster: EventCluster, screenX: number, screenY: number): TooltipData {
  const { type, events, count } = cluster;

  // ── Single event ────────────────────────────────────────────────────────────
  if (count === 1) {
    const e = events[0];
    const title = typeTitle(type, e.event as string);
    const entityLabel = e.entityType === 'bot' ? 'Bot' : 'Player';
    const lines: string[] = [
      `${entityLabel}: ${e.userId.slice(0, 12)}…`,
      `Time: ${formatTime(e.relativeSeconds)}`,
    ];

    // Kill events: explicitly state target is not recorded
    if (type === 'kill') {
      lines.push('Target: not recorded');
    }

    return { screenX, screenY, title, lines };
  }

  // ── Aggregated cluster ──────────────────────────────────────────────────────
  const baseTitle = typeTitle(type);
  const times = events.map(e => e.relativeSeconds).sort((a, b) => a - b);
  const lines: string[] = [
    `${count} events`,
    `Time range: ${formatTime(times[0])}–${formatTime(times[times.length - 1])}`,
  ];

  if (type === 'kill') {
    lines.push('Targets: not recorded');
  }

  return { screenX, screenY, title: `${baseTitle} ×${count}`, lines };
}

interface UseEventTooltipResult {
  tooltip: TooltipData | null;
  onMouseMove: (
    e: React.MouseEvent<HTMLCanvasElement>,
    clusters: EventCluster[],
    viewport: Viewport
  ) => void;
  onMouseLeave: () => void;
}

export function useEventTooltip(): UseEventTooltipResult {
  const [tooltip, setTooltip] = useState<TooltipData | null>(null);
  const lastCluster = useRef<EventCluster | null>(null);

  const onMouseMove = useCallback((
    e: React.MouseEvent<HTMLCanvasElement>,
    clusters: EventCluster[],
    viewport: Viewport
  ) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;

    const hit = hitTestClusters(
      clusters,
      screenX, screenY,
      viewport.offsetX, viewport.offsetY, viewport.scale
    );

    if (hit !== lastCluster.current) {
      lastCluster.current = hit;
      if (hit) {
        setTooltip(buildTooltip(hit, e.clientX, e.clientY));
      } else {
        setTooltip(null);
      }
    } else if (hit) {
      // Cluster unchanged — just track pointer position
      setTooltip(prev => prev ? { ...prev, screenX: e.clientX, screenY: e.clientY } : null);
    }
  }, []);

  const onMouseLeave = useCallback(() => {
    lastCluster.current = null;
    setTooltip(null);
  }, []);

  return { tooltip, onMouseMove, onMouseLeave };
}
