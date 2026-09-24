// src/components/EntityIcons.tsx
// Dedicated vector SVG iconography for Lila Black entity types.
// Tactical, restrained, recognizable at 12–16px.

interface IconProps {
  size?: number;
  color?: string;
  className?: string;
}

/**
 * Operative / Agent / Human operative icon.
 * Features tactical helmet contour, horizontal visor slit, and collar armor plate.
 */
export function HumanIcon({ size = 13, color = 'var(--color-accent)', className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {/* Operator Helmet Crown & Cheeks */}
      <path
        d="M7 1.75C5.2 1.75 4 3.05 4 4.8c0 1.25.6 2.3 1.5 2.85l-.25.85h3.5l-.25-.85c.9-.55 1.5-1.6 1.5-2.85 0-1.75-1.2-3.05-3-3.05z"
        stroke={color}
        strokeWidth="1.1"
        strokeLinejoin="round"
      />
      {/* Tactical Visor Slit */}
      <line x1="5.1" y1="4.9" x2="8.9" y2="4.9" stroke={color} strokeWidth="1.2" strokeLinecap="round" />
      {/* Tactical Collar / Armor Plate */}
      <path
        d="M2.5 12.25c.5-2.2 2-3.25 4.5-3.25s4 1.05 4.5 3.25"
        stroke={color}
        strokeWidth="1.1"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Automated Combat Bot / Mechanized Entity icon.
 * Features angular tactical chassis, dual optical sensors, and sensor mast.
 */
export function BotIcon({ size = 13, color = 'var(--color-accent-bot)', className }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 14 14"
      fill="none"
      className={className}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
    >
      {/* Sensor Antenna / Comms Mast */}
      <line x1="7" y1="1" x2="7" y2="3" stroke={color} strokeWidth="1.1" strokeLinecap="round" />
      {/* Angular Chassis */}
      <path
        d="M4.2 3.5h5.6l2 2.8v3.6l-2 2.6H4.2l-2-2.6V6.3l2-2.8z"
        stroke={color}
        strokeWidth="1.1"
        fill="none"
        strokeLinejoin="round"
      />
      {/* Dual Optical Sensors */}
      <circle cx="5.2" cy="7.2" r="1.1" fill={color} />
      <circle cx="8.8" cy="7.2" r="1.1" fill={color} />
      {/* Tactical Sensor Reticle Bridge */}
      <line x1="6.3" y1="7.2" x2="7.7" y2="7.2" stroke={color} strokeWidth="0.9" />
    </svg>
  );
}
