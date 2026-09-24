// src/utils/coordinateTransform.ts
//
// SINGLE SOURCE OF TRUTH for UV → canvas pixel conversion.
//
// The pipeline stores normalized UV coordinates [0, 1] using:
//   u = (world_x - origin_x) / scale
//   v = (world_z - origin_z) / scale
//
// The minimap image has its Y axis pointing DOWN (screen space),
// while the game world Z axis increases in one direction.
// The formula (1 - v) inverts V so that the top of the map image
// corresponds to the minimum world-Z (northern edge).
//
// DO NOT put this math anywhere else in the codebase.

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Convert a UV coordinate [0,1] to a canvas pixel position.
 *
 * @param u  - Normalized horizontal coordinate [0, 1]
 * @param v  - Normalized vertical coordinate [0, 1]
 * @param width  - Canvas/image width in pixels
 * @param height - Canvas/image height in pixels
 * @returns Canvas pixel {x, y}
 */
export function uvToCanvas(
  u: number,
  v: number,
  width: number,
  height: number
): CanvasPoint {
  return {
    x: u * width,
    y: (1 - v) * height,
  };
}
