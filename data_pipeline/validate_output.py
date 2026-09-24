import json
from pathlib import Path
from collections import Counter

data = Path('public/data')

# 1. Check matches.json - dates and durations
with open(data / 'matches.json') as f:
    matches = json.load(f)

print(f'Total matches: {len(matches)}')

print('\nFirst 5 matches:')
for m in matches[:5]:
    mid = m['matchId'][:28]
    print(f'  {mid}... map={m["mapId"]:15s} date={m["date"]} dur={m["durationSeconds"]}s')

# Date distribution
dates = Counter(m['date'] for m in matches)
print('\nDate distribution:')
for d, cnt in sorted(dates.items()):
    print(f'  {d}: {cnt} matches')

# Duration sanity
durs = [m['durationSeconds'] for m in matches]
print(f'\nDuration stats:')
print(f'  min={min(durs):.1f}s  max={max(durs):.1f}s  mean={sum(durs)/len(durs):.1f}s')
long_matches = [m for m in matches if m['durationSeconds'] > 60]
print(f'  Matches > 60s: {len(long_matches)}')

# Player distribution
print('\nPlayer count distribution:')
players = Counter(m['recordedPlayers'] for m in matches)
for cnt in sorted(players.keys()):
    print(f'  {cnt} player(s): {players[cnt]} matches')

# 2. Spot-check one multi-player match JSON
multi = [m for m in matches if m['recordedPlayers'] >= 6]
print(f'\nMatches with 6+ recorded players: {len(multi)}')
if multi:
    sample = multi[0]
    mid = sample['matchId']
    print(f'Inspecting match: {mid}')
    match_path = data / 'matches' / f'{mid}.json'
    with open(match_path) as f:
        events = json.load(f)
    print(f'  Total events: {len(events)}')
    print(f'  First 3 events:')
    for e in events[:3]:
        print(f'    seq={e["sequence"]} entity={e["entityType"]:5s} ts={e["tsSeconds"]} rel={e["relativeSeconds"]}s event={e["event"]:12s} uv=({e["uv"]["u"]:.4f},{e["uv"]["v"]:.4f})')
    print(f'  Last event: seq={events[-1]["sequence"]} rel={events[-1]["relativeSeconds"]}s event={events[-1]["event"]}')
    # Event type distribution in this match
    ev_counts = Counter(e['event'] for e in events)
    print(f'  Event breakdown: {dict(ev_counts)}')
    # Sequence monotonic check
    seqs = [e['sequence'] for e in events]
    print(f'  Sequence monotonic: {seqs == sorted(seqs)}')
    # tsSeconds in correct range (Feb 2026 = ~1770681000+)
    ts_vals = [e['tsSeconds'] for e in events]
    print(f'  tsSeconds range: {min(ts_vals)} to {max(ts_vals)}')
    print(f'  relativeSeconds range: {min(e["relativeSeconds"] for e in events):.1f}s to {max(e["relativeSeconds"] for e in events):.1f}s')
    # UV bounds
    out_of_bounds = [(e['uv']['u'], e['uv']['v']) for e in events if not (0 <= e['uv']['u'] <= 1 and 0 <= e['uv']['v'] <= 1)]
    print(f'  Out-of-bounds UV: {len(out_of_bounds)}')

# 3. Heatmaps sanity
print('\nHeatmap file sizes:')
for hf in (data / 'heatmaps').iterdir():
    with open(hf) as f:
        h = json.load(f)
    events_in = Counter(e['event'] for e in h)
    print(f'  {hf.name}: {len(h)} entries | {dict(events_in)}')

print('\nValidation report:')
with open(data / 'validation_report.json') as f:
    print(json.dumps(json.load(f), indent=2))
