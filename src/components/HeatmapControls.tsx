// src/components/HeatmapControls.tsx
// Sidebar control panel for spatial intelligence / heatmap mode.
// Placed as a distinct sidebar section — no redesign of existing sections.

import type { HeatmapMode, HeatmapScope } from '../hooks/useHeatmapGrid';

interface HeatmapControlsProps {
  mode: HeatmapMode;
  scope: HeatmapScope;
  onModeChange: (mode: HeatmapMode) => void;
  onScopeChange: (scope: HeatmapScope) => void;
  hasMatch: boolean;
  // Counts for the legend (total matching points in selected scope)
  counts: Record<HeatmapMode, number>;
  loading?: boolean;
}

interface ModeButtonDef {
  mode: HeatmapMode;
  label: string;
  color: string;
}

const MODES: ModeButtonDef[] = [
  { mode: 'none',    label: 'MAP',     color: 'var(--color-text-muted)' },
  { mode: 'traffic', label: 'TRAFFIC', color: 'var(--color-accent)' },
  { mode: 'kills',   label: 'KILLS',   color: 'var(--color-kill)' },
  { mode: 'deaths',  label: 'DEATHS',  color: 'var(--color-death)' },
  { mode: 'storm',   label: 'STORM',   color: 'var(--color-storm)' },
];

function countLabel(mode: HeatmapMode, count: number): string {
  switch (mode) {
    case 'traffic': return `${count.toLocaleString()} POSITION SAMPLES`;
    case 'kills':   return `${count.toLocaleString()} RECORDED KILLS`;
    case 'deaths':  return `${count.toLocaleString()} RECORDED DEATHS`;
    case 'storm':   return `${count.toLocaleString()} RECORDED STORM DEATHS`;
    default:        return '';
  }
}

function scopeLabel(scope: HeatmapScope): string {
  if (scope === 'all') return '5-DAY AGGREGATE';
  return 'CURRENT MATCH';
}

export function HeatmapControls({
  mode,
  scope,
  onModeChange,
  onScopeChange,
  hasMatch,
  counts,
  loading,
}: HeatmapControlsProps) {
  const activeCount = counts[mode];
  const activeModeDef = MODES.find(m => m.mode === mode);

  return (
    <div className="section">
      <div className="section-label">Spatial Intelligence</div>

      {/* Mode grid */}
      <div className="hm-mode-grid">
        {MODES.map(({ mode: m, label, color }) => (
          <button
            key={m}
            className={`hm-mode-btn${mode === m ? ' is-active' : ''}`}
            style={{ '--hm-color': color } as React.CSSProperties}
            onClick={() => onModeChange(m)}
            title={m === 'none' ? 'Standard map view' : `${label} density layer`}
            aria-pressed={mode === m}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Scope toggle — only shown when a mode is active */}
      {mode !== 'none' && (
        <div className="hm-scope-row">
          <button
            className={`hm-scope-btn${scope === 'all' ? ' is-active' : ''}`}
            onClick={() => onScopeChange('all')}
            aria-pressed={scope === 'all'}
            title="Show aggregate for all available data"
          >
            ALL DATA
          </button>
          <button
            className={`hm-scope-btn${scope === 'match' ? ' is-active' : ''}`}
            onClick={() => onScopeChange('match')}
            disabled={!hasMatch}
            aria-pressed={scope === 'match'}
            title="Show data for the current match only"
          >
            MATCH
          </button>
        </div>
      )}

      {/* Legend / analytical readout */}
      {mode !== 'none' && (
        <div className="hm-legend">
          {loading ? (
            <span className="hm-legend-loading">LOADING TELEMETRY...</span>
          ) : activeCount === 0 ? (
            <div className="hm-empty-state">
              <span className="hm-empty-title">
                {mode === 'storm' ? 'NO RECORDED STORM DEATHS' : 'NO RECORDED TELEMETRY'}
              </span>
              <span className="hm-empty-sub">
                {scope === 'match'
                  ? 'No matching events in current match telemetry'
                  : 'No spatial data recorded for this mode'}
              </span>
            </div>
          ) : (
            <>
              <div className="hm-legend-header">
                <span className="hm-legend-mode" style={{ color: activeModeDef?.color }}>
                  {activeModeDef?.label}
                </span>
                <div className="hm-legend-scope">· {scopeLabel(scope)}</div>
              </div>

              {/* Density ramp visual */}
              {mode !== 'storm' && (
                <div className="hm-density-ramp" aria-label="Density scale">
                  <span className="hm-ramp-label">LOW</span>
                  <div className={`hm-ramp hm-ramp--${mode}`} />
                  <span className="hm-ramp-label">HIGH</span>
                </div>
              )}

              <div className="hm-legend-count">{countLabel(mode, activeCount)}</div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
