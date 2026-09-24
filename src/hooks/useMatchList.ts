// src/hooks/useMatchList.ts
// Loads /data/matches.json once. Returns lightweight match metadata for the filter panel.

import { useEffect, useState } from 'react';
import type { MatchMeta } from '../types';

interface UseMatchListResult {
  matches: MatchMeta[];
  loading: boolean;
  error: string | null;
}

export function useMatchList(): UseMatchListResult {
  const [matches, setMatches] = useState<MatchMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/data/matches.json')
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load matches.json: ${r.status}`);
        return r.json() as Promise<MatchMeta[]>;
      })
      .then((data) => {
        setMatches(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  return { matches, loading, error };
}
