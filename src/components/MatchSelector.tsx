// src/components/MatchSelector.tsx
// Custom tactical match selector popover for Lila Black.
// Replaces native browser select with a mission-session selector.

import { useState, useRef, useEffect, useCallback } from 'react';
import { HumanIcon, BotIcon } from './EntityIcons';
import type { MatchMeta } from '../types';

interface MatchSelectorProps {
  matches: MatchMeta[];
  selectedMatchId: string | null;
  onSelectMatch: (matchId: string) => void;
  disabled?: boolean;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MatchSelector({
  matches,
  selectedMatchId,
  onSelectMatch,
  disabled = false,
}: MatchSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selectedMatch = matches.find((m) => m.matchId === selectedMatchId) ?? matches[0];

  // Close when clicking outside
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Scroll active match into view when opening
  useEffect(() => {
    if (isOpen && listRef.current) {
      const activeEl = listRef.current.querySelector('.is-selected');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [isOpen]);

  // Keyboard navigation on trigger / list
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (disabled || matches.length === 0) return;

      if (!isOpen) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      if (e.key === 'Escape') {
        e.preventDefault();
        setIsOpen(false);
        return;
      }

      const currentIndex = matches.findIndex((m) => m.matchId === selectedMatchId);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIdx = currentIndex < matches.length - 1 ? currentIndex + 1 : 0;
        onSelectMatch(matches[nextIdx].matchId);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIdx = currentIndex > 0 ? currentIndex - 1 : matches.length - 1;
        onSelectMatch(matches[prevIdx].matchId);
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setIsOpen(false);
      }
    },
    [disabled, isOpen, matches, selectedMatchId, onSelectMatch]
  );

  return (
    <div
      ref={containerRef}
      className={`match-selector-wrapper${isOpen ? ' is-open' : ''}${disabled ? ' is-disabled' : ''}`}
      onKeyDown={handleKeyDown}
    >
      {/* ── Trigger button (Closed state) ── */}
      <button
        type="button"
        id="match-selector-trigger"
        className="match-trigger"
        onClick={() => {
          if (!disabled && matches.length > 0) {
            setIsOpen((prev) => !prev);
          }
        }}
        disabled={disabled || matches.length === 0}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls="match-listbox"
        aria-label={selectedMatch ? `Match: ${formatDuration(selectedMatch.durationSeconds)}, ${selectedMatch.recordedPlayers} recorded` : 'Select match'}
      >
        {selectedMatch ? (
          <div className="match-trigger-content">
            {/* Top row: Duration (left) & Recorded player count (right) */}
            <div className="match-trigger-top">
              <span className="match-trigger-time">{formatDuration(selectedMatch.durationSeconds)}</span>
              <span className="match-trigger-rec">{selectedMatch.recordedPlayers} RECORDED</span>
            </div>

            {/* Bottom row: Human & Bot icon counts + Chevron indicator */}
            <div className="match-trigger-bottom">
              <div className="match-trigger-composition">
                <div className="match-comp-pill" title={`${selectedMatch.humans} Operative(s)`}>
                  <HumanIcon size={12} color="var(--color-accent)" />
                  <span className="match-comp-count">{selectedMatch.humans}</span>
                </div>
                <div className="match-comp-pill" title={`${selectedMatch.bots} Combat Bot(s)`}>
                  <BotIcon size={12} color="var(--color-accent-bot)" />
                  <span className="match-comp-count">{selectedMatch.bots}</span>
                </div>
              </div>

              <svg
                className={`match-trigger-chevron${isOpen ? ' is-open' : ''}`}
                width="10"
                height="6"
                viewBox="0 0 10 6"
                fill="none"
              >
                <path
                  d="M1 1l4 4 4-4"
                  stroke="var(--color-text-muted)"
                  strokeWidth="1.3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
        ) : (
          <div className="match-trigger-empty">
            <span>— No matches —</span>
          </div>
        )}
      </button>

      {/* ── Popover List (Opened state) ── */}
      {isOpen && (
        <div
          id="match-listbox"
          className="match-popover"
          role="listbox"
          aria-label="Matches List"
        >
          {/* Header */}
          <div className="match-popover-header">
            <span className="match-popover-title">MATCHES</span>
            <span className="match-popover-count">{matches.length}</span>
          </div>

          {/* Scrollable list */}
          <div ref={listRef} className="match-popover-list">
            {matches.map((m) => {
              const isSelected = m.matchId === selectedMatch?.matchId;
              const shortHash = m.matchId.split('.')[0].slice(-6);

              return (
                <div
                  key={m.matchId}
                  role="option"
                  aria-selected={isSelected}
                  tabIndex={0}
                  className={`match-item${isSelected ? ' is-selected' : ''}`}
                  onClick={() => {
                    onSelectMatch(m.matchId);
                    setIsOpen(false);
                  }}
                  title={`Match #${shortHash} · Duration: ${formatDuration(m.durationSeconds)} · Recorded: ${m.recordedPlayers}`}
                >
                  {/* Primary Row: Start time / duration + Recorded count */}
                  <div className="match-item-row-top">
                    <span className="match-item-time">{formatDuration(m.durationSeconds)}</span>
                    <span className="match-item-rec">{m.recordedPlayers} RECORDED</span>
                  </div>

                  {/* Secondary Row: Human/Bot composition + Subtle ID hash */}
                  <div className="match-item-row-bottom">
                    <div className="match-item-comp">
                      <div className="match-comp-pill">
                        <HumanIcon size={12} color="var(--color-accent)" />
                        <span className="match-comp-count">{m.humans}</span>
                      </div>
                      {m.bots > 0 && (
                        <div className="match-comp-pill">
                          <BotIcon size={12} color="var(--color-accent-bot)" />
                          <span className="match-comp-count">{m.bots}</span>
                        </div>
                      )}
                    </div>
                    <span className="match-item-hash">#{shortHash}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
