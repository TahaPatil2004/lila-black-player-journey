import { useMemo, useState } from 'react';
import './App.css';
import { MapCanvas } from './components/MapCanvas';
import { MatchSelector } from './components/MatchSelector';
import { Timeline } from './components/Timeline';
import { HeatmapControls } from './components/HeatmapControls';
import { HumanIcon, BotIcon } from './components/EntityIcons';
import { useMapData } from './hooks/useMapData';
import { useMatchList } from './hooks/useMatchList';
import { useMatchData } from './hooks/useMatchData';
import { useMinimapImage } from './hooks/useMinimapImage';
import { usePlayback } from './hooks/usePlayback';
import { useHeatmapData } from './hooks/useHeatmapData';
import { useHeatmapGrid } from './hooks/useHeatmapGrid';
import type { HeatmapMode, HeatmapScope } from './hooks/useHeatmapGrid';
import type { MatchMeta } from './types';


// ── Event visibility state ─────────────────────────────────────────────────
type EventVisibility = {
  kills: boolean;
  deaths: boolean;
  loot: boolean;
  storm: boolean;
};

const DEFAULT_VISIBILITY: EventVisibility = {
  kills: true,
  deaths: true,
  loot: true,
  storm: true,
};

// ── Helpers ────────────────────────────────────────────────────────────────

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase();
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatMapName(id: string): string {
  switch (id) {
    case 'AmbroseValley': return 'Ambrose Valley';
    case 'GrandRift':     return 'Grand Rift';
    case 'Lockdown':      return 'Lockdown';
    default:              return id;
  }
}

// ── App ────────────────────────────────────────────────────────────────────

export default function App() {
  const { maps, loading: mapsLoading } = useMapData();
  const { matches, loading: matchesLoading } = useMatchList();

  // ── Filter state ──────────────────────────────────────────────────────────
  const [selectedMapId,   setSelectedMapId]   = useState<string>('AmbroseValley');
  const [selectedDate,    setSelectedDate]    = useState<string | null>(null);
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [focusUserId,     setFocusUserId]     = useState<string | null>(null);
  const [eventVis,        setEventVis]        = useState<EventVisibility>(DEFAULT_VISIBILITY);

  // ── Heatmap state ───────────────────────────────────────────────────────────────
  const [heatmapMode,  setHeatmapMode]  = useState<HeatmapMode>('none');
  const [heatmapScope, setHeatmapScope] = useState<HeatmapScope>('all');


  const isLoading = mapsLoading || matchesLoading;

  // ── Derived filter data ───────────────────────────────────────────────────

  // Matches for the selected map
  const mapMatches = useMemo(
    () => matches.filter((m) => m.mapId === selectedMapId),
    [matches, selectedMapId]
  );

  // Valid dates for the selected map (sorted)
  const validDates = useMemo(() => {
    const set = new Set(mapMatches.map((m) => m.date));
    return Array.from(set).sort();
  }, [mapMatches]);

  // Auto-select first date when map changes and current date is invalid
  const effectiveDate = useMemo(() => {
    if (selectedDate && validDates.includes(selectedDate)) return selectedDate;
    return validDates[0] ?? null;
  }, [selectedDate, validDates]);

  // Matches for the selected map + date
  const dateMatches = useMemo(
    () => mapMatches.filter((m) => m.date === effectiveDate),
    [mapMatches, effectiveDate]
  );

  // Auto-select first match when date changes and current is invalid
  const effectiveMatchId = useMemo(() => {
    if (selectedMatchId && dateMatches.some((m) => m.matchId === selectedMatchId)) return selectedMatchId;
    return dateMatches[0]?.matchId ?? null;
  }, [selectedMatchId, dateMatches]);

  // Resolve the selected match object using effectiveMatchId
  const selectedMatch: MatchMeta | undefined = useMemo(
    () => dateMatches.find((m) => m.matchId === effectiveMatchId),
    [dateMatches, effectiveMatchId]
  );

  const mapConfig = maps.find((m) => m.mapId === selectedMapId);

  // ── Playback ───────────────────────────────────────────────────────────────
  // Must be placed after selectedMatch is declared.
  const matchDuration = selectedMatch?.durationSeconds ?? 0;
  const playback = usePlayback(matchDuration);

  // ── Data hooks ────────────────────────────────────────────────────────────

  const { image: minimapImage, loading: imageLoading } = useMinimapImage(mapConfig?.minimapFile ?? null);

  const { events, loading: eventsLoading, error: eventsError } = useMatchData(effectiveMatchId);

  // ── Heatmap data ──────────────────────────────────────────────────────────
  // All-data: prebuilt per-map JSON (5-day aggregate). Only fetched when a mode is active.
  const { points: allDataPoints, loading: heatmapLoading } = useHeatmapData(
    heatmapMode !== 'none' ? selectedMapId : null
  );

  // Storm raw points from allData (for discrete ring rendering)
  const stormAllPoints = useMemo(
    () => allDataPoints.filter(p => p.event === 'KilledByStorm'),
    [allDataPoints]
  );

  // Current-match points extracted from loaded match telemetry
  const matchPoints = useMemo(
    () => events.map(e => ({ u: e.uv.u, v: e.uv.v, event: e.event as string })),
    [events]
  );
  const stormMatchPoints = useMemo(
    () => matchPoints.filter(p => p.event === 'KilledByStorm'),
    [matchPoints]
  );

  // Active point set based on scope
  const activePoints      = heatmapScope === 'all' ? allDataPoints : matchPoints;
  const activeStormPoints = heatmapScope === 'all' ? stormAllPoints : stormMatchPoints;

  // Grid aggregation (memoized per mode + scope + points)
  const { grid: heatmapGrid, hotspots } = useHeatmapGrid(activePoints, heatmapMode, heatmapScope);

  // Raw counts for legend display — fast single-pass per point set
  const heatmapCounts = useMemo(() => {
    function countMode(mode: HeatmapMode, pts: typeof activePoints): number {
      if (mode === 'none') return 0;
      let c = 0;
      for (const p of pts) {
        if      (mode === 'traffic' && (p.event === 'Position' || p.event === 'BotPosition')) c++;
        else if (mode === 'kills'   && (p.event === 'Kill'     || p.event === 'BotKill'))     c++;
        else if (mode === 'deaths'  && (p.event === 'Killed'   || p.event === 'BotKilled'))   c++;
        else if (mode === 'storm'   &&  p.event === 'KilledByStorm')                          c++;
      }
      return c;
    }
    return {
      none:    0,
      traffic: countMode('traffic', activePoints),
      kills:   countMode('kills',   activePoints),
      deaths:  countMode('deaths',  activePoints),
      storm:   countMode('storm',   activePoints),
    };
  }, [activePoints]);

  // ── Derived player list ───────────────────────────────────────────────────

  const players = useMemo(() => {
    const seen = new Map<string, { userId: string; entityType: 'human' | 'bot' }>();
    for (const e of events) {
      if (!seen.has(e.userId)) {
        seen.set(e.userId, { userId: e.userId, entityType: e.entityType });
      }
    }
    return Array.from(seen.values());
  }, [events]);

  // Ensure player selection is cleared when match changes
  const effectiveFocusUser = useMemo(() => {
    if (!focusUserId) return null;
    if (players.some((p) => p.userId === focusUserId)) return focusUserId;
    return null;
  }, [focusUserId, players]);

  // ── Event counts by category for the current selection ────────────────────
  const eventCounts = useMemo(() => {
    const targetEvents = effectiveFocusUser
      ? events.filter((e) => e.userId === effectiveFocusUser)
      : events;

    let kills = 0;
    let deaths = 0;
    let loot = 0;
    let storm = 0;

    for (const e of targetEvents) {
      const ev = e.event as string;
      if (ev === 'Kill' || ev === 'BotKill') kills++;
      else if (ev === 'Killed' || ev === 'BotKilled') deaths++;
      else if (ev === 'Loot') loot++;
      else if (ev === 'KilledByStorm') storm++;
    }

    return { kills, deaths, loot, storm, total: kills + deaths + loot + storm };
  }, [events, effectiveFocusUser]);

  // ── Visible events — presentation layer only ──────────────────────────────

  const visibleEvents = useMemo(() => {
    let result = effectiveFocusUser
      ? events.filter((e) => e.userId === effectiveFocusUser)
      : events;

    // Apply event type visibility
    result = result.filter((e) => {
      const ev = e.event as string;
      if (!eventVis.kills  && (ev === 'Kill'   || ev === 'BotKill'))    return false;
      if (!eventVis.deaths && (ev === 'Killed' || ev === 'BotKilled'))  return false;
      if (!eventVis.loot   &&  ev === 'Loot')                           return false;
      if (!eventVis.storm  &&  ev === 'KilledByStorm')                  return false;
      return true;
    });

    return result;
  }, [events, effectiveFocusUser, eventVis]);


  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleMapChange(mapId: string) {
    setSelectedMapId(mapId);
    // Preserve selectedDate if valid in new map; effectiveDate will fallback if not
    setSelectedMatchId(null);
    setFocusUserId(null);
    playback.reset();
  }

  function handleDateChange(date: string) {
    setSelectedDate(date);
    setSelectedMatchId(null);
    setFocusUserId(null);
    playback.reset();
  }

  function handleMatchChange(matchId: string) {
    setSelectedMatchId(matchId);
    setFocusUserId(null);
    // usePlayback will auto-reset when duration changes (detected by the hook itself)
  }

  function toggleEvent(key: keyof EventVisibility) {
    setEventVis((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const isSparse = (selectedMatch?.recordedPlayers ?? 0) <= 1;

  // Timeline is shown whenever a match is loaded
  const showTimeline = !!effectiveMatchId && !eventsLoading;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="header">
        <span className="header-logo">Lila Black</span>
        <div className="header-divider" />
        <span className="header-title">Player Journey Analytics</span>
      </header>

      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-scroll">

          {/* MAP */}
          <div className="section">
            <div className="section-label">Map</div>
            <div className="ctrl-select">
              <select
                id="map-selector"
                value={selectedMapId}
                onChange={(e) => handleMapChange(e.target.value)}
                disabled={isLoading}
              >
                {maps.map((m) => (
                  <option key={m.mapId} value={m.mapId}>{formatMapName(m.mapId)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* DATE */}
          <div className="section">
            <div className="section-label">Date</div>
            <div className="ctrl-select">
              <select
                id="date-selector"
                value={effectiveDate ?? ''}
                onChange={(e) => handleDateChange(e.target.value)}
                disabled={isLoading || validDates.length === 0}
              >
                {validDates.length === 0 && <option value="">— No dates —</option>}
                {validDates.map((d) => (
                  <option key={d} value={d}>{formatDate(d)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* MATCH */}
          <div className="section">
            <div className="section-label">
              Match
              {dateMatches.length > 0 && (
                <span style={{ color: 'var(--color-text-micro)', marginLeft: 6, fontWeight: 400, letterSpacing: 0 }}>
                  {dateMatches.length}
                </span>
              )}
            </div>
            <MatchSelector
              matches={dateMatches}
              selectedMatchId={effectiveMatchId}
              onSelectMatch={handleMatchChange}
              disabled={isLoading || dateMatches.length === 0}
            />
          </div>

          {/* MATCH OVERVIEW */}
          {selectedMatch && (
            <div className="section">
              <div className="section-label">Overview</div>

              {/* Sparse telemetry warning */}
              {isSparse && (
                <div className="sparse-notice" style={{ marginBottom: 8 }}>
                  ⚠ Partial telemetry — 1 recorded player
                </div>
              )}

              <div className="match-summary">
                <div className="match-summary-row">
                  <span className="match-summary-key">Duration</span>
                  <span className="match-summary-val">{formatTime(selectedMatch.durationSeconds)}</span>
                </div>
                <div className="match-summary-row">
                  <span className="match-summary-key">Recorded</span>
                  <span className="match-summary-val">{selectedMatch.recordedPlayers}</span>
                </div>
                <div className="match-summary-row">
                  <span className="match-summary-key">Humans</span>
                  <span className="match-summary-val match-summary-val--human">{selectedMatch.humans}</span>
                </div>
                <div className="match-summary-row">
                  <span className="match-summary-key">Bots</span>
                  <span className="match-summary-val match-summary-val--bot">{selectedMatch.bots}</span>
                </div>
                <div className="match-summary-row">
                  <span className="match-summary-key">Recorded Events</span>
                  <span className="match-summary-val">{selectedMatch.eventCount.toLocaleString()}</span>
                </div>
              </div>
            </div>
          )}

          {/* RECORDED ENTITIES */}
          {players.length > 0 && (
            <div className="section">
              <div className="section-label">Recorded Entities</div>
              <div className="entity-roster">
                {/* All Recorded Entities row */}
                <div
                  className={`entity-row entity-row--all${effectiveFocusUser === null ? ' is-active' : ''}`}
                  onClick={() => setFocusUserId(null)}
                  title="Show all recorded entities"
                >
                  <div className="entity-icon">
                    <AllPlayersIcon active={effectiveFocusUser === null} />
                  </div>
                  <span className="entity-id">All Recorded Entities</span>
                  <span className="entity-badge">{players.length}</span>
                </div>

                {/* Individual players */}
                {players.map(({ userId, entityType }) => {
                  const isActive = effectiveFocusUser === userId;
                  const isBot = entityType === 'bot';
                  return (
                    <div
                      key={userId}
                      className={`entity-row${isActive ? (isBot ? ' is-active--bot' : ' is-active') : ''}`}
                      onClick={() => setFocusUserId(isActive ? null : userId)}
                      title={userId}
                    >
                      <div className="entity-icon">
                        {isBot ? (
                          <BotIcon size={13} color={isActive ? 'var(--color-accent-bot)' : 'var(--color-text-muted)'} />
                        ) : (
                          <HumanIcon size={13} color={isActive ? 'var(--color-accent)' : 'var(--color-text-muted)'} />
                        )}
                      </div>
                      <span className="entity-id">{userId.slice(0, 10)}…</span>
                      <span className="entity-badge">{isBot ? 'BOT' : 'HUMAN'}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* EVENTS */}
          <div className="section">
            <div className="section-label">Events</div>
            <div className="event-toggles">
              <EventToggle
                category="kills"
                label="Kills"
                on={eventVis.kills}
                count={eventCounts.kills}
                color="var(--color-kill)"
                shape="x"
                onToggle={() => toggleEvent('kills')}
              />
              <EventToggle
                category="deaths"
                label="Deaths"
                on={eventVis.deaths}
                count={eventCounts.deaths}
                color="var(--color-death)"
                shape="circle"
                onToggle={() => toggleEvent('deaths')}
              />
              <EventToggle
                category="loot"
                label="Loot"
                on={eventVis.loot}
                count={eventCounts.loot}
                color="var(--color-loot)"
                shape="diamond"
                onToggle={() => toggleEvent('loot')}
              />
              <EventToggle
                category="storm"
                label="Storm"
                on={eventVis.storm}
                count={eventCounts.storm}
                color="var(--color-storm)"
                shape="bolt"
                onToggle={() => toggleEvent('storm')}
              />
            </div>

            {/* Empty state notices */}
            {eventCounts.total === 0 && !eventsLoading && events.length > 0 && (
              <div className="empty-events-notice">
                <span className="empty-events-title">NO RECORDED EVENTS</span>
                <span className="empty-events-sub">
                  {effectiveFocusUser ? 'Selected entity has no combat or loot events' : 'No recorded combat events for this match'}
                </span>
              </div>
            )}
            {eventCounts.total > 0 && (!eventVis.kills && !eventVis.deaths && !eventVis.loot && !eventVis.storm) && (
              <div className="empty-events-notice">
                <span className="empty-events-title">ALL EVENTS HIDDEN</span>
                <span className="empty-events-sub">Toggle event categories above to view markers</span>
              </div>
            )}
          </div>

          {/* LEGEND */}
          <div className="section">
            <div className="section-label">Paths</div>
            <div className="legend">
              <div className="legend-item">
                <div className="legend-line legend-line--human" />
                Recorded human path
              </div>
              <div className="legend-item">
                <div className="legend-line legend-line--bot" />
                Recorded bot path
              </div>
            </div>
          </div>

          {/* SPATIAL INTELLIGENCE */}
          <HeatmapControls
            mode={heatmapMode}
            scope={heatmapScope}
            onModeChange={setHeatmapMode}
            onScopeChange={setHeatmapScope}
            hasMatch={!!effectiveMatchId}
            counts={heatmapCounts}
            loading={heatmapLoading}
          />

        </div>{/* end .sidebar-scroll */}
      </aside>

      {/* ── Main canvas area + timeline ───────────────────────────────────── */}
      <div className="main-area">
        <main className="main">
          {/* Loading */}
          {(imageLoading || eventsLoading) && (
            <div className="overlay">
              <div className="tac-loader">
                <div className="overlay-label">
                  LOADING TELEMETRY...
                </div>
                <div className="tac-loader-bar">
                  <div className="tac-loader-fill" />
                </div>
              </div>
            </div>
          )}

          {/* Error */}
          {eventsError && (
            <div className="overlay" style={{ color: '#f87171' }}>
              <div className="overlay-label">TELEMETRY ERROR</div>
              <div className="overlay-sub">{eventsError}</div>
            </div>
          )}

          {/* No match selected */}
          {!effectiveMatchId && !imageLoading && !eventsLoading && (
            <div className="overlay">
              <div className="overlay-label">SELECT A MATCH TO BEGIN</div>
              <div className="overlay-sub">Choose a map, date, and match from the tactical console</div>
            </div>
          )}

          <MapCanvas
            key={selectedMapId}
            image={minimapImage}
            events={visibleEvents}
            focusUserId={effectiveFocusUser}
            currentTime={playback.currentTime}
            heatmapMode={heatmapMode}
            heatmapGrid={heatmapMode !== 'none' && heatmapMode !== 'storm' ? heatmapGrid : null}
            stormPoints={heatmapMode === 'storm' ? activeStormPoints : null}
            hotspots={heatmapMode !== 'none' && heatmapMode !== 'storm' ? hotspots : undefined}
          />

        </main>

        {/* Timeline bar — only shown when a match is loaded */}
        {showTimeline && (
          <Timeline
            currentTime={playback.currentTime}
            isPlaying={playback.isPlaying}
            speed={playback.speed}
            duration={playback.duration}
            play={playback.play}
            pause={playback.pause}
            reset={playback.reset}
            seek={playback.seek}
            setSpeed={playback.setSpeed}
            visibleEvents={visibleEvents}
          />
        )}
      </div>
    </div>
  );
}

// ── Inline SVG Icons ──────────────────────────────────────────────────────

function AllPlayersIcon({ active }: { active: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="5" cy="5" r="2" stroke={active ? 'var(--color-accent)' : 'var(--color-text-muted)'} strokeWidth="1.2" />
      <circle cx="9" cy="5" r="2" stroke={active ? 'var(--color-accent)' : 'var(--color-text-muted)'} strokeWidth="1.2" />
      <path d="M1 12c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" stroke={active ? 'var(--color-accent)' : 'var(--color-text-muted)'} strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

// ── Event toggle row ──────────────────────────────────────────────────────

type ToggleCategory = 'kills' | 'deaths' | 'loot' | 'storm';
type ToggleShape = 'x' | 'circle' | 'diamond' | 'bolt';

interface EventToggleProps {
  category: ToggleCategory;
  label: string;
  on: boolean;
  count: number;
  color: string;
  shape: ToggleShape;
  onToggle: () => void;
}

function EventToggle({
  category,
  label,
  on,
  count,
  color,
  shape,
  onToggle,
}: EventToggleProps) {
  return (
    <div
      role="switch"
      aria-checked={on}
      aria-label={`${label} visibility, ${count} recorded`}
      tabIndex={0}
      className={`event-toggle-row event--${category}${on ? ' is-on' : ' is-off'}`}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ '--event-color': color } as React.CSSProperties}
    >
      <div className="event-toggle-icon">
        <svg width="12" height="12" viewBox="-6 -6 12 12" style={{ flexShrink: 0 }}>
          {shape === 'x' && (
            <>
              <circle r="5.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <line x1="-2.5" y1="-2.5" x2="2.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              <line x1="2.5" y1="-2.5" x2="-2.5" y2="2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </>
          )}
          {shape === 'circle' && (
            <>
              <circle r="5.5" fill="none" stroke="currentColor" strokeWidth="1" />
              <circle r="2" fill="currentColor" />
            </>
          )}
          {shape === 'diamond' && (
            <>
              <polygon points="0,-5 4,0 0,5 -4,0" fill="none" stroke="currentColor" strokeWidth="1" />
              <circle r="1.2" fill="currentColor" />
            </>
          )}
          {shape === 'bolt' && (
            <>
              <polygon points="0,-5 4,0 0,5 -4,0" fill="none" stroke="currentColor" strokeWidth="1" />
              <polyline points="1.5,-3 -1,0 1,0 -1.5,3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </>
          )}
        </svg>
      </div>

      <span className="event-toggle-label">{label}</span>
      <span className="event-toggle-count">{count}</span>

      <div className="event-switch">
        <div className="event-switch-thumb" />
      </div>
    </div>
  );
}
