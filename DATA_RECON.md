# Player Data Reconnaissance Report

## 1. Dataset Summary
- **Total Parquet files:** 1,243
- **Number of files per date:**
  - February 10: 437
  - February 11: 293
  - February 12: 268
  - February 13: 166
  - February 14: 79
- **Total rows/events:** 89,104
- **Unique user IDs:** 339
- **Unique human users:** 245
- **Unique bot users:** 94
- **Unique match IDs:** 796
- **Number of matches per map:**
  - AmbroseValley: 566
  - Lockdown: 171
  - GrandRift: 59

## 2. Schema and Data Types
| Column | Type | Notes |
|--------|------|-------|
| `user_id` | `string` | UUID for humans, numeric for bots |
| `match_id` | `string` | Unique match identifier |
| `map_id` | `string` | Map name |
| `x` | `float32` | World X coordinate |
| `y` | `float32` | World Y coordinate (elevation) |
| `z` | `float32` | World Z coordinate |
| `ts` | `timestamp[ms]` | Event timestamp |
| `event` | `binary` | Event type (must be decoded from bytes to string) |

*Zero null or missing values were found across all columns.*

## 3. Event Type Distribution
- **Position:** 51,347
- **BotPosition:** 21,712
- **Loot:** 12,885
- **BotKill:** 2,415
- **BotKilled:** 700
- **KilledByStorm:** 39
- **Kill:** 3
- **Killed:** 3

## 4. Map and Coordinate System Verification
**Coordinate ranges (X, Z) observed in the data:**
- **AmbroseValley:** X (-325.0 to 301.8), Z (-380.0 to 360.8)
- **GrandRift:** X (-225.9 to 256.6), Z (-194.0 to 170.1)
- **Lockdown:** X (-406.6 to 348.4), Z (-285.1 to 329.2)

**Minimap Coordinates (U, V) bounds verification:**
When applying the conversion formula `(coord - origin) / scale`, all resulting U and V coordinates safely fall within the expected `0.0` to `1.0` range. 

## 5. Discrepancies and Data Quality Findings
1. **Minimap Image Dimensions Discrepancy (CRITICAL):**
   The README states that all minimap images are 1024x1024 pixels. **This is false.** The actual image dimensions are:
   - AmbroseValley_Minimap.png: 4320 x 4320
   - GrandRift_Minimap.png: 2160 x 2158 (Not even a perfect square!)
   - Lockdown_Minimap.jpg: 9000 x 9000

---

## Timestamp Semantics

**Evidence:**
- The raw integers stored in the Parquet files for the `ts` column evaluate to roughly `1,770,681,535`.
- The Arrow schema incorrectly annotates the column type as `timestamp[ms]` (milliseconds since Unix epoch). When evaluated as milliseconds, `1,770,681,535` ms evaluates to `1970-01-21 11:51:21`. This causes the absolute duration of a match to seem like a fraction of a second (e.g., 0.89 seconds = 890 ms).
- However, when evaluated correctly as **SECONDS** since Unix epoch, the value `1,770,681,535` translates exactly to **February 10, 2026, 23:58:55 UTC**, which perfectly aligns with the dataset folder structure (Feb 10-14, 2026).
- If the difference is roughly 890 units, that represents 890 seconds (~14.8 minutes), which is an appropriate duration for a battle royale match.

**Representative Example (Match 1 Raw Timestamps):**
| user_id | event | ts (Arrow format) | raw integer value |
|---|---|---|---|
| `0019c582...` | `Position` | `1970-01-21 11:51:21.535` | `1770681535` |
| `0019c582...` | `Position` | `1970-01-21 11:51:21.536` | `1770681536` |

**Conclusion:** 
The dataset stores timestamps in **absolute wall-clock seconds**, despite the README falsely claiming they are relative "milliseconds elapsed within the match."

**Confidence Level:** 100%

**Implications for Playback:**
The UI must treat the parsed numeric values as seconds, not milliseconds. To build a relative playback slider, the application must compute `relative_seconds = current_event_ts - min_match_ts`. 

---

## Duplicate Semantics

**Evidence:**
After deeper analysis of consecutive records and intra-second event distributions, we discovered crucial behaviors tied to the 1-second timestamp precision:
- **Intra-second Movement:** There are **50,547** cases where a player emits multiple `Position` events at the exact same timestamp but with **different** `x,y,z` coordinates. This proves the game samples movement continuously (likely per-frame or per-tick), meaning multiple events legitimately share a 1-second timestamp.
- **Stationary vs Duplicates:** There are **0** instances of identical `Position` coordinates across *different* timestamps. This indicates the game does not emit stationary heartbeat telemetry, or float precision drift prevents identical matches. Therefore, when up to 10 purely identical `Position` rows appear at the *same* timestamp, they are conclusively ingestion duplicates/telemetry retries, not a stationary player.
- **Multi-Event Actions:** For `Loot` and `Kill` events, we observe identical rows (e.g., up to 7 identical `Loot` records for the same user/ts/xyz). Because the schema lacks an `item_id` or `victim_id`, picking up 3 items instantly from a chest generates 3 identical `Loot` rows. A grenade multi-kill would generate identical `Kill` rows.
- **Combat Nuances:** The sequence analysis revealed instances of `Kill` and `Killed` events occurring at the exact same timestamp and coordinates, indicating complex scenarios like trade-kills.

**Recommended Handling Strategy:**
Based on the evidence, destructive deduplication of the raw dataset is dangerous and will destroy legitimate telemetry.
1. **Raw Data:** Do **not** deduplicate the raw dataset on load. Preserve all records to maintain accurate event volume (multi-kills, multi-loots).
2. **Path Visualization (Position/BotPosition):** Preserve all intra-second coordinates to correctly render the fluid movement path (ordering by file sequence, as timestamp is insufficient). The frontend rendering loop can visually coalesce purely identical consecutive coordinate points to optimize canvas performance, as they are guaranteed ingestion duplicates.
3. **Event Visualization (Loot/Combat):** Do not deduplicate. Instead, visually group/cluster them in the UI. For example, if three identical `Loot` events occur at the same location/timestamp, render a single UI icon labeled "Loot (x3)" and log them distinctly in the event feed.

---

## Match Coverage

**Evidence:**
- **Distribution of recorded player files per match (across 796 matches):**
  - Min: 1
  - Median: 1.0
  - Mean: 1.56
  - 75th percentile: 1.0
  - 90th percentile: 1.0
  - Max: 16

**Breakdown:**
- 1 player: 743 matches (93.3% of the dataset)
- 2 players: 1 match
- 3-5 players: 2 matches
- 6-10 players: 32 matches
- 11+ players: 18 matches

Sparse matches are uniformly distributed across all dates and maps. 

**UI / Product Implications:**
93% of the matches only contain data for a single user (meaning no other players will appear on the minimap for them). When that user kills someone or gets killed, we will almost never have the opposing player's coordinates. The UI must elegantly handle single-player visualization and perhaps inform the user (e.g. via a tooltip or a "Players in match: 1" label) so they do not assume the application is broken when the map looks empty.

---

## Final Engineering Recommendations

1. **Timestamps:** Disregard the README documentation. Convert the raw Parquet integer directly into seconds. Compute relative match time per-match by subtracting the minimum timestamp from all other timestamps in the match to drive a playback slider.
2. **Duplicates:** Apply a strict whole-row deduplication on data load to drop the 1,420 telemetry retries, but intentionally allow multiple events from the same user to share the same timestamp (second). 
3. **Sparse Matches:** Ensure the UI visualization logic doesn't crash if it cannot find the target of a `Kill` or `Killed` event. Clearly surface the "Number of Recorded Players: X" metric on the UI so the sparse data constraint is transparent to the user.
4. **Dynamic Minimap Dimensions:** The application must read the true width/height of the minimap image to compute pixel coordinates, discarding the `1024x1024` assumption.
