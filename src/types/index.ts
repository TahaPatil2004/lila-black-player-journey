// src/types/index.ts
// Normalized data contracts — mirror the schema produced by the Python pipeline.
// These types are the single source of truth for the frontend data layer.

export interface MapConfig {
  mapId: string;
  scale: number;
  originX: number;
  originZ: number;
  minimapFile: string; // filename only, served from /minimaps/<filename>
}

export interface MatchMeta {
  matchId: string;
  mapId: string;
  date: string;
  durationSeconds: number;
  recordedPlayers: number;
  humans: number;
  bots: number;
  eventCount: number;
}

export interface WorldCoord {
  x: number;
  y: number; // elevation — preserved for future use
  z: number;
}

export interface UVCoord {
  u: number;
  v: number;
}

export type EntityType = 'human' | 'bot';

export type EventName =
  | 'Position'
  | 'BotPosition'
  | 'Kill'
  | 'BotKill'
  | 'Killed'
  | 'BotKilled'
  | 'KilledByStorm'
  | 'Loot';

export interface NormalizedEvent {
  sequence: number;
  userId: string;
  entityType: EntityType;
  matchId: string;
  mapId: string;
  tsSeconds: number;
  relativeSeconds: number;
  event: EventName;
  world: WorldCoord;
  uv: UVCoord;
}

export type MatchData = NormalizedEvent[];
