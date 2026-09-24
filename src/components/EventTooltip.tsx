// src/components/EventTooltip.tsx
// A lightweight DOM tooltip rendered as an absolutely-positioned div.
// It lives outside the canvas so text is always crisp and readable.

import type { TooltipData } from '../hooks/useEventTooltip';

interface EventTooltipProps {
  data: TooltipData;
}

export function EventTooltip({ data }: EventTooltipProps) {
  const PAD = 12;
  let left = data.screenX + PAD;
  let top  = data.screenY + PAD;

  return (
    <div
      style={{
        position: 'fixed',
        left,
        top,
        pointerEvents: 'none',
        zIndex: 1000,
        background: 'rgba(10, 11, 16, 0.92)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 8,
        padding: '8px 12px',
        minWidth: 160,
        boxShadow: '0 4px 24px rgba(0,0,0,0.55)',
        backdropFilter: 'blur(8px)',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: '#e2e8f0',
          marginBottom: 4,
          letterSpacing: '0.04em',
        }}
      >
        {data.title}
      </div>
      {data.lines.map((line, i) => (
        <div
          key={i}
          style={{
            fontSize: 11,
            color: '#64748b',
            lineHeight: 1.6,
          }}
        >
          {line}
        </div>
      ))}
    </div>
  );
}
