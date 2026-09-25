# Lila Black — Player Journey Visualization

An interactive spatial analytics tool for Lila Black Level Designers to explore player traversal paths, combat engagements, match playback, and spatial heatmaps from five days of production telemetry.

## Live Demo

Deployment URL: https://lila-black-player-journey-murex.vercel.app/

## Overview

This application is a browser-based player journey visualization tool built for Lila Black Level Designers. It transforms 89,104 production telemetry records across 796 matches into an interactive spatial analysis interface. The tool enables level designers and combat analysts to explore how players move through map spaces, where engagements happen, how individual encounters unfold over time, and where spatial density concentrates across playtest sessions.

The system visualizes telemetry across three distinct maps: **Ambrose Valley**, **Grand Rift**, and **Lockdown**.

## How to Use

1. **Select a Match:** In the left sidebar, choose a **Map** (e.g., Ambrose Valley), a **Date** (Feb 10–14, 2026), and a specific **Match**. The top-down minimap and match overview metrics will populate immediately.
2. **Inspect Player Journeys:** View player paths drawn on the minimap. Human players are rendered in cyan with solid lines; AI bots are rendered in orange with dashed lines.
3. **Isolate an Entity:** Click on any entity in the **Recorded Entities** list to isolate their journey path while dimming all other entities. Click "All Recorded Entities" to restore the full lobby view.
4. **Filter & Inspect Events:** Toggle event markers on or off using the **Events** panel (Kills, Deaths, Loot, Storm). Hover over any clustered map icon to inspect detailed tooltips displaying timestamp, entity ID, and world coordinates.
5. **Control Match Playback:** Use the bottom **Timeline** bar to control replay scrubbing:
   - Click **Play / Pause** to run real-time playback.
   - Drag the scrubber handle to seek to any point in the match duration.
   - Adjust playback speed between **0.5x, 1x, 2x, 4x, and 8x**.
   - Click **Reset** to return to static full-match overview mode.
6. **Analyze Spatial Heatmaps:** Under **Spatial Intelligence**, click any mode (**TRAFFIC**, **KILLS**, **DEATHS**, **STORM**) to render smoothed density heatmaps.
7. **Toggle Heatmap Scope:** Switch between **ALL DATA** (5-day aggregate map intelligence) and **MATCH** (density specific to the active match).
8. **Inspect Tactical Hotspots:** When an aggregate heatmap is active, top density clusters are automatically marked with leader lines and callout badges (`HOT 01`, `HOT 02`, etc.) indicating raw event counts.
9. **Navigate the Map Canvas:** Click and drag on the map to pan; scroll the mouse wheel or pinch to zoom. Use the zoom controls or double-click to reset the view.

## What You Can Explore

- **Multi-Map Minimap Rendering:** Accurate top-down visualization across Ambrose Valley, Grand Rift, and Lockdown with native aspect ratios and map-specific coordinate systems.
- **Player Journey Trajectories:** Movement paths reconstructed from recorded `Position` and `BotPosition` telemetry, with distinct visual styling for human players (cyan) and AI bots (orange).
- **Interactive Match Playback:** Scrubbable timeline with play, pause, seek, and multi-speed controls (0.5x to 8x) driven by a `requestAnimationFrame` clock, featuring animated entity position pings.
- **Combat & World Event Markers:** Clustered visual badges for kills, deaths, loot pickups, and storm eliminations with hover tooltips detailing timestamps, entity IDs, and coordinates.
- **Spatial Intelligence Heatmaps:** Layered density heatmaps for Traffic, Kills, Deaths, and Storm events, switchable between 5-day aggregate map data and current-match scope.
- **Tactical Hotspot Annotations:** Automatic identification and callout labeling of top density clusters with leader lines and raw event count badges.
- **Filtering & Entity Isolation:** Multi-level filtering by Map, Playtest Date, Match ID, and individual Player focus (highlighting the selected player's route while dimming others).
- **Fluid Canvas Navigation:** Pan, zoom (mouse wheel and pinch), and view reset controls mapped to a 2D canvas drawing surface.

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **Data Preprocessing** | Python 3, PyArrow, Pandas | Ingestion of 1,243 Parquet files, duplicate elimination, timestamp recovery, entity classification, and UV projection. |
| **Frontend Framework** | React 19, TypeScript | Component orchestration, reactive filtering, and interactive state management. |
| **Rendering Engine** | HTML5 2D Canvas, OffscreenCanvas | Layered spatial rendering for minimap imagery, player paths, event markers, and heatmap rasterization. |
| **Build Tooling & Linting** | Vite 8, Oxlint | Client bundling, Hot Module Replacement (HMR), TypeScript type checking (`tsc -b`), and static code linting. |
| **Hosting & Distribution** | Static Single-Page Application (SPA) | Pure client-side bundle (`dist/`), deployable to any edge CDN or static hosting platform (Vercel, Netlify, Cloudflare Pages, GitHub Pages). |

## Architecture

The system uses a two-phase architecture that separates heavy data processing from interactive presentation:

```
Parquet Telemetry (1,243 files)
  → Python Preprocessing Pipeline (PyArrow / Pandas)
  → Normalized Static JSON Assets (public/data/)
  → React 19 + TypeScript + Vite SPA
  → HTML5 Multi-Layer Canvas Renderer (OffscreenCanvas + RAF)
  → Interactive Visualization Console
```

- Build-time preprocessing cleans, validates, and projects telemetry into normalized UV space `[0, 1]` saved as partitioned static JSON.
- The browser loads lightweight match metadata on startup and lazy-fetches individual match telemetry and aggregate heatmap points only on demand.
- Spatial rendering is handled directly via an HTML5 Canvas drawing surface rather than managing large DOM/SVG trees.

For full technical details on coordinate projections, data assumptions, and engineering tradeoffs, see [ARCHITECTURE.md](ARCHITECTURE.md).

## Data Pipeline

The preprocessing pipeline (`data_pipeline/pipeline.py`) performs the following operations:

1. **Ingestion & Decoding:** Reads 1,243 `.nakama-0` Parquet files, decodes binary event names to UTF-8, and converts raw integer timestamps into true Unix epoch seconds.
2. **Deduplication:** Removes exact full-row ingestion duplicates while preserving distinct movement samples that share the same second-level timestamp.
3. **Entity Classification:** Classifies UUID strings as human players and numeric IDs (`^\d+$`) as AI bots.
4. **Coordinate Mapping:** Projects 3D world coordinates `(x, z)` to normalized UV coordinates `[0, 1]` using each map's documented origin and scale:
   - Ambrose Valley: `scale = 900.0`, `origin_x = -370.0`, `origin_z = -473.0`
   - Grand Rift: `scale = 581.0`, `origin_x = -290.0`, `origin_z = -290.0`
   - Lockdown: `scale = 1000.0`, `origin_x = -500.0`, `origin_z = -500.0`
5. **Artifact Generation:** Produces browser-ready static assets in `public/data/`:
   - `maps.json`: Map bounding boxes, origin offsets, scales, and minimap image filenames.
   - `matches.json`: Lightweight match catalog (duration, map, date, player/bot counts) loaded on initial startup.
   - `matches/<matchId>.json`: Chronological event streams for individual matches, lazy-loaded on selection.
   - `heatmaps/<mapId>.json`: Pre-extracted map-level spatial event and movement points used by the frontend to construct 5-day heatmaps.
   - `validation_report.json`: Automated pipeline validation covering row counts, duplicate removal, unknown event types, invalid map IDs, and out-of-bounds UV coordinates.

*Note: The repository includes the preprocessed, browser-ready JSON artifacts under `public/data/`. The application runs immediately out of the box without requiring the original raw Parquet archive.*

## Validation

The data pipeline validates the entire dataset during preprocessing (`public/data/validation_report.json`):

- **Raw Files Discovered & Read:** 1,243 of 1,243 (0 failures)
- **Raw Telemetry Rows Ingested:** 89,104
- **Exact Full-Row Duplicates Removed:** 1,505
- **Rows Retained:** 87,599 (72,849 position samples, 14,750 discrete events)
- **Unknown Event Types:** 0
- **Invalid Map IDs:** 0
- **Out-of-Bounds UV Coordinates:** 0
- **Matches Written:** 796 matches across 3 maps
- **Heatmap Point Files Generated:** 3 (one per map)

## Data Notes & Assumptions

- **Recorded Telemetry vs. Ground Truth:** The telemetry captures client-recorded perspectives rather than omniscient server-wide ground truth. In 795 of 796 matches, telemetry reflects one human client encountering proximate bots.
- **Timestamp Semantics:** Raw Parquet integer timestamps evaluate to ~1,770,681,500. Although the Arrow schema annotates the column as `timestamp[ms]`, treating these as milliseconds places matches in January 1970. Interpreting the integer as absolute Unix seconds places matches correctly in February 10–14, 2026. Relative playback seconds are computed per match as $(t - t_{\min})$.
- **Missing Combat Victim Telemetry:** `Kill` and `BotKill` records log attacker coordinates but contain no victim identifier or victim location.
- **Entity Classification:** Numeric-only `user_id` values represent server-controlled AI bots; UUID strings represent human client players.
- **Multiple Samples per Second-Level Timestamp:** Distinct position updates can share the same 1-second timestamp value. Sorting by timestamp and original file ingestion sequence preserves deterministic ordering for rendering and playback.

## Known Limitations

- **Incomplete Lobby Coverage:** Because client telemetry captures only the local player and proximate entities, unrecorded players in the same lobby are not visible.
- **Attacker-Only Combat Locations:** Combat markers represent the recorded actor's coordinates; victim identifiers and victim locations are not available.
- **Sparse Storm Telemetry:** Only 39 storm deaths occurred across the entire 5-day dataset, which is insufficient for continuous density modeling.
- **Descriptive, Not Predictive:** Heatmaps illustrate observed historical traffic and combat clusters, not causal engagement probability.

## Project Documentation

- [Architecture](ARCHITECTURE.md) — System architecture, coordinate transformations, data flow, assumptions, and engineering tradeoffs.
- [Gameplay Insights](INSIGHTS.md) — Three evidence-backed level design findings derived from the telemetry dataset.

## Local Setup

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Installation & Development

1. Clone the repository:
   ```bash
   git clone https://github.com/TahaPatil2004/lila-black-player-journey.git
   cd lila-black-player-journey
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the local development server:
   ```bash
   npm run dev
   ```
   Open the printed local URL (typically `http://localhost:5173`) in your browser.

4. Build for production:
   ```bash
   npm run build
   ```

5. Preview the production build locally:
   ```bash
   npm run preview
   ```

### (Optional) Running the Data Pipeline

If the raw `player_data/` directory is present and you wish to regenerate the static JSON data:

1. Install Python dependencies:
   ```bash
   pip install -r data_pipeline/requirements.txt
   ```

2. Execute the preprocessing script:
   ```bash
   python data_pipeline/pipeline.py
   ```

## Environment Variables

No environment variables are required. The application runs as a client-side static application using the preprocessed JSON files in `public/data/`.
