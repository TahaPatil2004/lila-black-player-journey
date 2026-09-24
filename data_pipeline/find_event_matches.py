import json
import os
from collections import Counter

match_dir = 'public/data/matches'
files = os.listdir(match_dir)

# Find matches with KilledByStorm specifically
storm_matches = []
kill_matches = []
kill_and_killed = []

for f in files:
    with open(os.path.join(match_dir, f)) as fp:
        events = json.load(fp)
    counts = Counter(e['event'] for e in events)
    
    if counts.get('KilledByStorm', 0) > 0:
        storm_matches.append((f, dict(counts)))
    if (counts.get('Kill', 0) + counts.get('BotKill', 0)) > 0 and (counts.get('Killed', 0) + counts.get('BotKilled', 0)) > 0:
        score = sum(counts.values())
        kill_and_killed.append((score, f, dict(counts)))

print(f"Matches with KilledByStorm: {len(storm_matches)}")
if storm_matches:
    f, c = storm_matches[0]
    print(f"  Example: {f}")
    print(f"  Counts: {c}")

kill_and_killed.sort(reverse=True)
print(f"\nMatches with Kill+Killed (richest):")
for score, f, c in kill_and_killed[:3]:
    print(f"  {f}: {c}")
