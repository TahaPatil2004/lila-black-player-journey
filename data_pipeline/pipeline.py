"""
pipeline.py
LILA BLACK — Player Journey Visualization Tool
Phase 2: Build-time preprocessing pipeline

Reads raw Parquet telemetry, normalizes it, and writes static JSON
assets to public/data/ for consumption by the React frontend.

Usage:
    python pipeline.py

Output structure:
    public/data/
        maps.json            – map configuration + minimap metadata
        matches.json         – lightweight match index (for filters)
        matches/<match>.json – full normalized event stream per match
        heatmaps/
            AmbroseValley.json
            GrandRift.json
            Lockdown.json
        validation_report.json
"""

from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import pandas as pd
import pyarrow.parquet as pq

# ── Project imports ───────────────────────────────────────────────────────────
PIPELINE_DIR = Path(__file__).parent
REPO_ROOT = PIPELINE_DIR.parent
sys.path.insert(0, str(PIPELINE_DIR))

from map_config import MAP_CONFIGS, get_map_config, world_to_uv
from utils import (
    ALL_EXPECTED_EVENTS,
    DISCRETE_EVENTS,
    POSITION_EVENTS,
    classify_entity,
    decode_event,
    is_discrete_event,
    is_position_event,
    parse_ts_to_seconds,
)

# ── Paths ────────────────────────────────────────────────────────────────────
DATA_ROOT = REPO_ROOT / "player_data" / "player_data"
OUTPUT_ROOT = REPO_ROOT / "public" / "data"
DATE_FOLDERS = [
    "February_10",
    "February_11",
    "February_12",
    "February_13",
    "February_14",
]

# Date folder → ISO date string mapping
DATE_LABELS: dict[str, str] = {
    "February_10": "2026-02-10",
    "February_11": "2026-02-11",
    "February_12": "2026-02-12",
    "February_13": "2026-02-13",
    "February_14": "2026-02-14",
}


# ── Output schema dataclasses ─────────────────────────────────────────────────

@dataclass
class WorldCoord:
    x: float
    y: float
    z: float


@dataclass
class UVCoord:
    u: float
    v: float


@dataclass
class NormalizedEvent:
    sequence: int
    userId: str
    entityType: str          # 'human' | 'bot'
    matchId: str
    mapId: str
    tsSeconds: int           # absolute wall-clock seconds since Unix epoch
    relativeSeconds: float   # seconds elapsed since the first event of the match
    event: str
    world: dict              # {x, y, z}  — y retained for future elevation feature
    uv: dict                 # {u, v}  — normalized [0,1] map coordinates


@dataclass
class MatchMeta:
    matchId: str
    mapId: str
    date: str
    durationSeconds: float
    recordedPlayers: int
    humans: int
    bots: int
    eventCount: int


@dataclass
class ValidationReport:
    raw_files_discovered: int = 0
    raw_files_read: int = 0
    raw_files_failed: int = 0
    raw_rows_total: int = 0
    exact_duplicates_removed: int = 0
    rows_after_dedup: int = 0
    position_events: int = 0
    discrete_events: int = 0
    unknown_events: int = 0
    unknown_event_types: list = field(default_factory=list)
    invalid_map_ids: int = 0
    invalid_map_ids_list: list = field(default_factory=list)
    out_of_bounds_uv: int = 0
    matches_written: int = 0
    heatmaps_written: int = 0
    failed_files: list = field(default_factory=list)


# ── File discovery ────────────────────────────────────────────────────────────

def discover_files() -> list[tuple[str, Path]]:
    """Return list of (date_label, file_path) for every .nakama-0 file."""
    found: list[tuple[str, Path]] = []
    for date_folder in DATE_FOLDERS:
        folder = DATA_ROOT / date_folder
        if not folder.exists():
            print(f"  [WARN] Folder not found: {folder}")
            continue
        for f in sorted(folder.iterdir()):
            if f.suffix == "" or f.name.endswith(".nakama-0"):
                if f.is_file() and ".nakama-0" in f.name:
                    found.append((date_folder, f))
    return found


# ── Parquet loading ───────────────────────────────────────────────────────────

def load_parquet_file(path: Path) -> pd.DataFrame | None:
    """
    Read a single Parquet file into a DataFrame.
    Returns None on failure.
    """
    try:
        table = pq.read_table(str(path))
        df = table.to_pandas()
        return df
    except Exception as exc:
        print(f"  [ERROR] Cannot read {path.name}: {exc}")
        return None


# ── Row normalization ─────────────────────────────────────────────────────────

def normalize_row(
    row: pd.Series,
    sequence: int,
    min_ts: int,
) -> NormalizedEvent | None:
    """
    Normalize a single raw DataFrame row into a NormalizedEvent.

    Returns None if the row contains an unknown map_id.
    """
    map_id = str(row["map_id"])
    try:
        cfg = get_map_config(map_id)
    except KeyError:
        return None

    event = decode_event(row["event"])
    user_id = str(row["user_id"])
    entity_type = classify_entity(user_id)

    ts_sec = parse_ts_to_seconds(row["ts"])
    relative_sec = float(ts_sec - min_ts)

    x = float(row["x"])
    y = float(row["y"])
    z = float(row["z"])
    u, v = world_to_uv(x, z, cfg)

    return NormalizedEvent(
        sequence=sequence,
        userId=user_id,
        entityType=entity_type,
        matchId=str(row["match_id"]),
        mapId=map_id,
        tsSeconds=ts_sec,
        relativeSeconds=relative_sec,
        event=event,
        world={"x": round(x, 4), "y": round(y, 4), "z": round(z, 4)},
        uv={"u": round(u, 6), "v": round(v, 6)},
    )


# ── Main pipeline ─────────────────────────────────────────────────────────────

def run_pipeline() -> None:
    print("=" * 60)
    print("LILA BLACK — Preprocessing Pipeline")
    print("=" * 60)

    report = ValidationReport()

    # ── Step 1: Discover files ─────────────────────────────────────────────
    print("\n[1/7] Discovering Parquet files...")
    file_index = discover_files()
    report.raw_files_discovered = len(file_index)
    print(f"  Found {report.raw_files_discovered} files.")

    # ── Step 2: Load all files into memory ────────────────────────────────
    print("\n[2/7] Loading Parquet files...")
    all_frames: list[pd.DataFrame] = []
    for date_label, path in file_index:
        df = load_parquet_file(path)
        if df is None:
            report.raw_files_failed += 1
            report.failed_files.append(str(path))
            continue
        df["_source_date"] = date_label
        df["_source_file"] = path.name
        all_frames.append(df)
        report.raw_files_read += 1

    if not all_frames:
        print("  [FATAL] No files could be read. Aborting.")
        sys.exit(1)

    print(f"  Read: {report.raw_files_read} | Failed: {report.raw_files_failed}")

    # ── Step 3: Merge + exact-duplicate removal ───────────────────────────
    print("\n[3/7] Merging and removing exact duplicate rows...")
    full_df = pd.concat(all_frames, ignore_index=True)
    report.raw_rows_total = len(full_df)

    # Decode event bytes before duplicate check so comparison is text-based.
    full_df["event"] = full_df["event"].apply(decode_event)

    # Exact whole-row duplicate detection uses all telemetry columns
    # (excluding internal pipeline metadata columns).
    telemetry_cols = ["user_id", "match_id", "map_id", "x", "y", "z", "ts", "event"]
    before = len(full_df)
    full_df = full_df.drop_duplicates(subset=telemetry_cols, keep="first")
    after = len(full_df)
    report.exact_duplicates_removed = before - after
    report.rows_after_dedup = after

    print(f"  Raw rows         : {report.raw_rows_total:,}")
    print(f"  Exact dupes removed: {report.exact_duplicates_removed:,}")
    print(f"  Rows retained    : {report.rows_after_dedup:,}")

    # ── Step 4: Validate map IDs and event types ──────────────────────────
    print("\n[4/7] Validating map IDs and event types...")

    known_maps = set(MAP_CONFIGS.keys())
    invalid_mask = ~full_df["map_id"].isin(known_maps)
    report.invalid_map_ids = int(invalid_mask.sum())
    report.invalid_map_ids_list = list(full_df.loc[invalid_mask, "map_id"].unique())

    unknown_event_mask = ~full_df["event"].isin(ALL_EXPECTED_EVENTS)
    report.unknown_events = int(unknown_event_mask.sum())
    report.unknown_event_types = list(full_df.loc[unknown_event_mask, "event"].unique())

    report.position_events = int(full_df["event"].isin(POSITION_EVENTS).sum())
    report.discrete_events = int(full_df["event"].isin(DISCRETE_EVENTS).sum())

    print(f"  Position events  : {report.position_events:,}")
    print(f"  Discrete events  : {report.discrete_events:,}")
    print(f"  Unknown events   : {report.unknown_events:,}",
          report.unknown_event_types if report.unknown_event_types else "")
    print(f"  Invalid map IDs  : {report.invalid_map_ids:,}")

    # Drop rows with invalid map IDs — they cannot be plotted.
    if report.invalid_map_ids > 0:
        print(f"  [WARN] Dropping {report.invalid_map_ids} rows with unrecognised map IDs.")
        full_df = full_df[~invalid_mask].copy()

    # ── Step 5: Group by match and normalize ─────────────────────────────
    print("\n[5/7] Normalizing and grouping by match...")

    # We need the minimum timestamp per match to compute relativeSeconds.
    # parse_ts_to_seconds applied per row is necessary here.
    full_df["_ts_sec"] = full_df["ts"].apply(parse_ts_to_seconds)
    # Preserve the row order from file reads as a stable secondary sort key.
    # This reflects the original telemetry sequence within each file.
    full_df["_original_order"] = range(len(full_df))
    match_min_ts = full_df.groupby("match_id")["_ts_sec"].min()

    # Derive match date from the _source_date column already attached to each row.
    # (The parquet match_id includes the .nakama-0 suffix, so filename-split parsing
    #  never produced a matching key — hence all dates previously showed "unknown".)
    match_dates: dict[str, str] = {
        match_id: DATE_LABELS.get(date_folder, "unknown")
        for match_id, date_folder in full_df.groupby("match_id")["_source_date"].first().items()
    }

    output_matches: dict[str, str] = {}  # match_id → date
    all_match_meta: list[MatchMeta] = []

    # Heatmap collectors: map_id → list of {u, v, event}
    heatmap_data: dict[str, list[dict]] = defaultdict(list)

    out_of_bounds_count = 0
    matches_written = 0

    matches_dir = OUTPUT_ROOT / "matches"
    matches_dir.mkdir(parents=True, exist_ok=True)
    (OUTPUT_ROOT / "heatmaps").mkdir(parents=True, exist_ok=True)

    for match_id, match_df in full_df.groupby("match_id"):
        match_id = str(match_id)
        min_ts = int(match_min_ts[match_id])
        date_str = match_dates.get(match_id, "unknown")

        # Assign sequence within the match:
        # Primary sort: tsSeconds ascending.
        # Secondary sort: _original_order (global row number from file-read order)
        # This guarantees deterministic ordering when multiple events share
        # the same 1-second timestamp, preserving the intra-second telemetry
        # sequence as originally recorded.
        match_df = match_df.sort_values(
            by=["_ts_sec", "_original_order"],
            ascending=True,
        ).reset_index(drop=True)

        events_out: list[dict] = []
        humans: set[str] = set()
        bots: set[str] = set()

        for seq_idx, (_, row) in enumerate(match_df.iterrows()):
            evt = normalize_row(row, sequence=seq_idx, min_ts=min_ts)
            if evt is None:
                continue

            # Out-of-bounds UV check
            u, v = evt.uv["u"], evt.uv["v"]
            if not (0.0 <= u <= 1.0 and 0.0 <= v <= 1.0):
                out_of_bounds_count += 1

            if evt.entityType == "human":
                humans.add(evt.userId)
            else:
                bots.add(evt.userId)

            events_out.append({
                "sequence": evt.sequence,
                "userId": evt.userId,
                "entityType": evt.entityType,
                "matchId": evt.matchId,
                "mapId": evt.mapId,
                "tsSeconds": evt.tsSeconds,
                "relativeSeconds": evt.relativeSeconds,
                "event": evt.event,
                "world": evt.world,
                "uv": evt.uv,
            })

            # Accumulate heatmap data for this map
            heatmap_data[evt.mapId].append({
                "u": u,
                "v": v,
                "event": evt.event,
            })

        if not events_out:
            continue

        duration = float(match_df["_ts_sec"].max() - min_ts)

        meta = MatchMeta(
            matchId=match_id,
            mapId=str(match_df["map_id"].iloc[0]),
            date=date_str,
            durationSeconds=duration,
            recordedPlayers=len(humans) + len(bots),
            humans=len(humans),
            bots=len(bots),
            eventCount=len(events_out),
        )
        all_match_meta.append(meta)

        # Write per-match JSON
        out_path = matches_dir / f"{match_id}.json"
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(events_out, fh, separators=(",", ":"))

        matches_written += 1

    report.out_of_bounds_uv = out_of_bounds_count
    report.matches_written = matches_written

    print(f"  Matches processed : {matches_written:,}")
    print(f"  Out-of-bounds UV  : {out_of_bounds_count:,}")

    # ── Step 6: Write top-level JSON assets ───────────────────────────────
    print("\n[6/7] Writing top-level assets...")

    # matches.json — lightweight index
    matches_list = [asdict(m) for m in all_match_meta]
    with open(OUTPUT_ROOT / "matches.json", "w", encoding="utf-8") as fh:
        json.dump(matches_list, fh, indent=2)

    # maps.json — map config + minimap metadata
    maps_out: list[dict] = []
    minimaps_dir = DATA_ROOT / "minimaps"
    for map_id, cfg in MAP_CONFIGS.items():
        minimap_filename = None
        for ext in [".png", ".jpg", ".jpeg"]:
            candidate = minimaps_dir / f"{map_id}_Minimap{ext}"
            if candidate.exists():
                minimap_filename = f"{map_id}_Minimap{ext}"
                break

        maps_out.append({
            "mapId": cfg.map_id,
            "scale": cfg.scale,
            "originX": cfg.origin_x,
            "originZ": cfg.origin_z,
            "minimapFile": minimap_filename,
        })

    with open(OUTPUT_ROOT / "maps.json", "w", encoding="utf-8") as fh:
        json.dump(maps_out, fh, indent=2)

    # heatmaps/<mapId>.json
    # Store all UV + event entries; the frontend aggregates into density grids.
    # Keeping raw UV preserves flexibility for the renderer to choose grid resolution.
    for map_id, entries in heatmap_data.items():
        out_path = OUTPUT_ROOT / "heatmaps" / f"{map_id}.json"
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(entries, fh, separators=(",", ":"))
    report.heatmaps_written = len(heatmap_data)
    print(f"  Heatmap files written: {report.heatmaps_written}")

    # ── Step 7: Validation report ─────────────────────────────────────────
    print("\n[7/7] Writing validation report...")

    validation_out = {
        "rawFilesDiscovered": report.raw_files_discovered,
        "rawFilesRead": report.raw_files_read,
        "rawFilesFailed": report.raw_files_failed,
        "rawRowsTotal": report.raw_rows_total,
        "exactDuplicatesRemoved": report.exact_duplicates_removed,
        "rowsAfterDedup": report.rows_after_dedup,
        "breakdown": {
            "positionEvents": report.position_events,
            "discreteEvents": report.discrete_events,
            "unknownEvents": report.unknown_events,
            "unknownEventTypes": report.unknown_event_types,
        },
        "invalidMapIds": report.invalid_map_ids,
        "invalidMapIdValues": report.invalid_map_ids_list,
        "outOfBoundsUV": report.out_of_bounds_uv,
        "matchesWritten": report.matches_written,
        "heatmapsWritten": report.heatmaps_written,
        "failedFiles": report.failed_files,
    }

    with open(OUTPUT_ROOT / "validation_report.json", "w", encoding="utf-8") as fh:
        json.dump(validation_out, fh, indent=2)

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 60)
    print("PIPELINE COMPLETE")
    print("=" * 60)
    print(f"  Files discovered       : {report.raw_files_discovered:,}")
    print(f"  Files read OK          : {report.raw_files_read:,}")
    print(f"  Files failed           : {report.raw_files_failed:,}")
    print(f"  Raw rows               : {report.raw_rows_total:,}")
    print(f"  Exact dupes removed    : {report.exact_duplicates_removed:,}")
    print(f"  Rows retained          : {report.rows_after_dedup:,}")
    print(f"    |-- Position events  : {report.position_events:,}")
    print(f"    +-- Discrete events  : {report.discrete_events:,}")
    print(f"  Out-of-bounds UV       : {report.out_of_bounds_uv:,}")
    print(f"  Matches written        : {report.matches_written:,}")
    print(f"  Heatmap files          : {report.heatmaps_written:,}")
    if report.raw_files_failed:
        print(f"\n  [WARN] Failed files:")
        for f in report.failed_files:
            print(f"    {f}")
    print("\nOutputs written to:", OUTPUT_ROOT)


if __name__ == "__main__":
    run_pipeline()
