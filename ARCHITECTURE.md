# Architecture

## 1. System Overview

The Lila Black Player Journey Visualizer transforms raw client-recorded match telemetry into an interactive spatial analytics tool designed for Level Designers. The system processes 89,104 telemetry events across 796 matches into clean spatial layers, enabling intuitive exploration of player traversal paths, combat engagements, and spatial density.

**Architecture Pipeline:**
```
Raw Parquet Files (1,243 files)
  → Python Preprocessing Pipeline (PyArrow / Pandas)
  → Normalized Static JSON Assets (public/data/)
  → React 19 + TypeScript + Vite SPA
  → HTML5 Multi-Layer Canvas Renderer (OffscreenCanvas + RAF)
  → Interactive Map, Playback Timeline & Spatial Intelligence Heatmaps
```

- **Preprocessing:** Python 3 (`pyarrow`, `pandas`) for batch extraction, validation, and spatial normalization.
- **Frontend Core:** React 19, TypeScript, and Vite for UI state and component orchestration.
- **Rendering Engine:** HTML5 2D Canvas with `OffscreenCanvas` caching and requestAnimationFrame loops.
- **Distribution:** Completely static single-page application (SPA), deployable to any edge CDN or static host.

## 2. Why This Architecture

Level Designers require rapid visual feedback when scrubbing timelines, filtering players, and toggling spatial heatmaps across playtest sessions. Pushing raw Parquet parsing (1,243 files, ~89K rows) into the client browser via WebAssembly would introduce initialization latency, memory overhead, and complex client-side thread management. Instead, heavy data validation, schema normalization, and spatial projections are resolved at build time into lightweight static JSON. The browser loads lightweight match metadata upfront and fetches detailed match telemetry only when a match is selected. Canvas keeps spatial rendering in a drawing surface rather than creating large DOM/SVG element trees, while OffscreenCanvas is used for heatmap rasterization.

## 3. Data Flow

1. **Ingestion:** `data_pipeline/pipeline.py` traverses `player_data/` across five daily folders (Feb 10–14, 2026), ingesting 1,243 `.nakama-0` Parquet files.
2. **Decoding & Deduplication:** Binary event names are decoded to UTF-8; raw timestamps are converted to Unix seconds. The pipeline strips 1,505 exact full-row ingestion duplicates while preserving genuine intra-second tick samples.
3. **Spatial Normalization:** World coordinates `(x, z)` are projected into normalized UV space `[0, 1]` per map configuration.
4. **Generated Static Artifacts (`public/data/`):**
   - `maps.json`: Map bounding boxes, origin offsets, world scales, and minimap image filenames.
   - `matches.json`: Lightweight match catalog (duration, map, date, player/bot counts) loaded on initial startup.
   - `matches/<matchId>.json`: Full chronologically ordered event streams for individual matches, fetched lazily on selection.
   - `heatmaps/<mapId>.json`: Pre-extracted spatial event points used to build 5-day map-level heatmaps.
   - `validation_report.json`: Automated pipeline audit confirming zero unhandled event types or coordinate anomalies.
5. **Client Presentation:** The React client initializes by fetching `maps.json` and `matches.json`. When an analyst selects a match, `useMatchData` lazily retrieves the match payload. `MapCanvas` draws layers onto the canvas: minimap background, offscreen-buffered heatmap raster, player paths, clustered event markers, and tactical hotspot callouts.

## 4. Coordinate Mapping

Accurately projecting 3D game coordinates onto 2D top-down minimaps requires reconciling differing world origins, scales, and axis orientations. The transformation is split into a build-time UV projection and a runtime screen-space mapping, centralized in `src/utils/coordinateTransform.ts`:

1. **World to Normalized UV Space `[0, 1]` (Build-time):**
   $$u = \frac{x - \text{origin}_x}{\text{scale}}, \quad v = \frac{z - \text{origin}_z}{\text{scale}}$$
   - **AmbroseValley:** `scale = 900.0`, `origin_x = -370.0`, `origin_z = -473.0`
   - **GrandRift:** `scale = 581.0`, `origin_x = -290.0`, `origin_z = -290.0`
   - **Lockdown:** `scale = 1000.0`, `origin_x = -500.0`, `origin_z = -500.0`
   *(World Y represents vertical elevation and is preserved in data payloads for future height-map features).*

2. **Normalized UV to Canvas Pixel Space (Runtime):**
   $$\text{canvasX} = u \times \text{width}, \quad \text{canvasY} = (1 - v) \times \text{height}$$
   **Vertical Inversion `(1 - v)`:** In 2D screen/image space, Y coordinates increase downward from the top-left origin `(0, 0)`. In the game engine, world Z increases northward (upward). The `(1 - v)` inversion maps positive world Z to the northern (top) edge of the minimap image.

## 5. Important Data Assumptions

- **Timestamp Semantics:** Raw integer values in the Parquet files evaluate to ~1,770,681,500. Although the Arrow schema labels the column as `timestamp[ms]`, treating these values as milliseconds places matches in January 1970. Interpreting the integer as absolute Unix seconds resolves precisely to February 10–14, 2026. Match timelines compute relative playback seconds as $(t - t_{\min})$.
- **Event Decoding:** The Parquet `event` column stores raw binary bytes; strings are decoded via UTF-8.
- **Entity Classification:** Player identifiers matching `^\d+$` (pure numeric strings) are classified as AI bots; UUID strings are classified as human players.
- **Single-Client Perspective:** Telemetry is client-recorded rather than omniscient server-side ground truth. Most matches have sparse entity coverage, so the visualization should not be interpreted as a complete lobby reconstruction.
- **Missing Combat Victims:** `Kill` and `BotKill` records log attacker coordinates but contain no victim identifier or victim location.
- **Duplicate & Sequence Ordering:** Consecutive position points can share the same 1-second timestamp because the source telemetry has one-second timestamp resolution. Events are ordered deterministically by timestamp and ingestion sequence for rendering and playback.

## 6. Major Tradeoffs

| Decision | Alternative Considered | Engineering Rationale |
|---|---|---|
| **Build-time Python preprocessing** | Client-side Parquet / WASM | Moves Parquet parsing and validation out of the browser and keeps the client focused on interactive visualization. |
| **HTML5 Canvas + OffscreenCanvas** | DOM / SVG element trees | Better suited to layered spatial rendering and heatmap rasterization without managing large DOM trees. |
| **Static pre-partitioned JSON** | Runtime API / PostgreSQL database | Avoids maintaining a runtime data service for this static assignment dataset. |
| **Lazy match telemetry loading** | Eager bulk loading of all 796 matches | Keeps initial client data lightweight and loads detailed telemetry only on demand. |
| **OffscreenCanvas heatmap rasterization** | Per-frame Canvas density recomputation | Generates smoothed density buffers once on state change rather than recalculating blurs on every render frame. |
