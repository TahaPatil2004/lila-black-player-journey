import json
import os
from collections import Counter

match_dir = 'public/data/matches'
files = os.listdir(match_dir)
print(f"Total matches: {len(files)}")

# Find a match with rich events (kills, loot, storm)
best_match = None
best_score = 0

for f in files[:100]:  # sample first 100
    with open(os.path.join(match_dir, f)) as fp:
        events = json.load(fp)
    
    counts = Counter(e['event'] for e in events)
    score = counts.get('Kill', 0) + counts.get('BotKill', 0) + counts.get('Loot', 0) + counts.get('KilledByStorm', 0) * 5
    
    if score > best_score:
        best_score = score
        best_match = (f, counts, len(events))

fname, counts, total = best_match
print(f"\nBest match for testing: {fname}")
print(f"Total events: {total}")
print("Event distribution:")
for k, v in sorted(counts.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v}")
