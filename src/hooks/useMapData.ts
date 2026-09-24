// src/hooks/useMapData.ts
// Loads /data/maps.json once on mount. Exposes loading state and the map list.

import { useEffect, useState } from 'react';
import type { MapConfig } from '../types';

interface UseMapDataResult {
  maps: MapConfig[];
  loading: boolean;
  error: string | null;
}

export function useMapData(): UseMapDataResult {
  const [maps, setMaps] = useState<MapConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/maps.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load maps.json: ${r.status}`);
        return r.json() as Promise<MapConfig[]>;
      })
      .then((data) => {
        setMaps(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { maps, loading, error };
}
