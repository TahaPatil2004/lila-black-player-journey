// src/hooks/useHeatmapData.ts
// Loads and caches the pre-built heatmap point array for a given map.
// The JSON is a flat array of { u, v, event } raw telemetry points.
// This hook is responsible only for fetching — aggregation is separate.

import { useEffect, useState } from 'react';

export interface HeatmapPoint {
  u: number;
  v: number;
  event: string;
}

interface UseHeatmapDataResult {
  points: HeatmapPoint[];
  loading: boolean;
  error: string | null;
}

// Module-level cache so the same file is not re-fetched when switching modes
const cache = new Map<string, HeatmapPoint[]>();

export function useHeatmapData(mapId: string | null): UseHeatmapDataResult {
  const [points, setPoints] = useState<HeatmapPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState<string | null>(null);

  useEffect(() => {
    if (!mapId) {
      setPoints([]);
      return;
    }

    if (cache.has(mapId)) {
      setPoints(cache.get(mapId)!);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/data/heatmaps/${mapId}.json`)
      .then(r => {
        if (!r.ok) throw new Error(`Heatmap load failed for ${mapId}: ${r.status}`);
        return r.json() as Promise<HeatmapPoint[]>;
      })
      .then(data => {
        cache.set(mapId, data);
        setPoints(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [mapId]);

  return { points, loading, error };
}
