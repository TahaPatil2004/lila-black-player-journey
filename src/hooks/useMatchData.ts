// src/hooks/useMatchData.ts
// On-demand loader for individual match JSON files.
// Only fetches when matchId changes — never preloads all 796 matches.

import { useEffect, useState } from 'react';
import type { MatchData } from '../types';

interface UseMatchDataResult {
  events: MatchData;
  loading: boolean;
  error: string | null;
}

export function useMatchData(matchId: string | null): UseMatchDataResult {
  const [events, setEvents] = useState<MatchData>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) {
      setEvents([]);
      return;
    }

    setLoading(true);
    setError(null);

    fetch(`/data/matches/${matchId}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load match ${matchId}: ${r.status}`);
        return r.json() as Promise<MatchData>;
      })
      .then((data) => {
        setEvents(data);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  }, [matchId]);

  return { events, loading, error };
}
