"""
map_config.py
Reusable coordinate transformation configuration for all LILA BLACK maps.

World-to-UV formula:
    u = (x - origin_x) / scale
    v = (z - origin_z) / scale

UV origin is top-left of the minimap image.
Note: image y-flip is the responsibility of the renderer (not the pipeline),
since it depends on the actual pixel height of the displayed image.

The pipeline stores u/v in the range [0, 1].
"""

from dataclasses import dataclass
from typing import Dict


@dataclass(frozen=True)
class MapConfig:
    map_id: str
    scale: float
    origin_x: float
    origin_z: float


# Single source of truth for all map configurations.
# Values sourced from dataset README and validated against actual telemetry.
MAP_CONFIGS: Dict[str, MapConfig] = {
    "AmbroseValley": MapConfig(
        map_id="AmbroseValley",
        scale=900.0,
        origin_x=-370.0,
        origin_z=-473.0,
    ),
    "GrandRift": MapConfig(
        map_id="GrandRift",
        scale=581.0,
        origin_x=-290.0,
        origin_z=-290.0,
    ),
    "Lockdown": MapConfig(
        map_id="Lockdown",
        scale=1000.0,
        origin_x=-500.0,
        origin_z=-500.0,
    ),
}


def world_to_uv(x: float, z: float, cfg: MapConfig) -> tuple[float, float]:
    """
    Convert world coordinates (x, z) to normalized UV coordinates [0, 1].

    Args:
        x: World X coordinate.
        z: World Z coordinate (depth axis; Y is elevation and is not used here).
        cfg: MapConfig for the relevant map.

    Returns:
        (u, v) both in the range [0, 1].
    """
    u = (x - cfg.origin_x) / cfg.scale
    v = (z - cfg.origin_z) / cfg.scale
    return u, v


def get_map_config(map_id: str) -> MapConfig:
    """
    Return the MapConfig for a given map_id.

    Raises:
        KeyError: if map_id is not recognised.
    """
    if map_id not in MAP_CONFIGS:
        raise KeyError(
            f"Unknown map_id '{map_id}'. "
            f"Expected one of: {list(MAP_CONFIGS.keys())}"
        )
    return MAP_CONFIGS[map_id]
