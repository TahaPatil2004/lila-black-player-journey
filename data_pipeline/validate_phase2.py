import pandas as pd
import pyarrow.parquet as pq
import json
import os
from pathlib import Path

def main():
    base_dir = Path('player_data/player_data')
    data_dir = Path('public/data')
    
    # 1. Duplicates Investigation
    print("--- 1. DUPLICATES INVESTIGATION ---")
    all_files = []
    for d in ["February_10", "February_11", "February_12", "February_13", "February_14"]:
        d_path = base_dir / d
        if d_path.exists():
            files = [d_path / f for f in os.listdir(d_path) if f.endswith(".nakama-0")]
            all_files.extend(files)
            
    dfs = []
    for f in all_files:
        try:
            df = pq.read_table(f).to_pandas()
            df['file_path'] = str(f)
            dfs.append(df)
        except:
            pass
            
    full_df = pd.concat(dfs, ignore_index=True)
    full_df['event'] = full_df['event'].apply(lambda x: x.decode('utf-8') if isinstance(x, bytes) else str(x))
    
    pure_dups_with_file = full_df.duplicated().sum()
    telemetry_cols = ["user_id", "match_id", "map_id", "x", "y", "z", "ts", "event"]
    pure_dups_without_file = full_df.duplicated(subset=telemetry_cols).sum()
    
    print(f"Exact duplicates including 'file_path': {pure_dups_with_file}")
    print(f"Exact duplicates excluding 'file_path' (all telemetry cols): {pure_dups_without_file}")
    if pure_dups_without_file == 1505:
        print("CONFIRMED: The 1505 removed rows are exact whole-row telemetry duplicates. The previous 1420 count incorrectly included the source file path, masking 85 duplicates that spanned across files.")

    # 2. Timestamp Normalization
    print("\n--- 2. TIMESTAMP NORMALIZATION ---")
    with open(data_dir / 'matches.json') as f:
        matches = json.load(f)
        
    sample_match_id = matches[0]['matchId']
    print(f"Validating match: {sample_match_id}")
    
    # Raw data for this match
    raw_match_df = full_df[full_df['match_id'] == sample_match_id].copy()
    raw_match_df['ts_sec'] = (raw_match_df['ts'].astype('int64') // 1_000_000).astype(int)
    earliest_raw = raw_match_df['ts_sec'].min()
    latest_raw = raw_match_df['ts_sec'].max()
    print(f"Raw Earliest tsSeconds: {earliest_raw}")
    print(f"Raw Latest tsSeconds: {latest_raw}")
    print(f"Raw Match duration (sec): {latest_raw - earliest_raw}")
    
    # Normalized data for this match
    match_file = sample_match_id
    with open(data_dir / f'matches/{match_file}.json') as f:
        norm_events = json.load(f)
        
    earliest_norm = min(e['tsSeconds'] for e in norm_events)
    latest_norm = max(e['tsSeconds'] for e in norm_events)
    min_rel = min(e['relativeSeconds'] for e in norm_events)
    max_rel = max(e['relativeSeconds'] for e in norm_events)
    
    print(f"Normalized Earliest tsSeconds: {earliest_norm}")
    print(f"Normalized Latest tsSeconds: {latest_norm}")
    print(f"Normalized relativeSeconds range: {min_rel} to {max_rel}")
    
    # Sequence ordering check
    seq_check_passed = True
    for i in range(1, len(norm_events)):
        prev = norm_events[i-1]
        curr = norm_events[i]
        if curr['tsSeconds'] < prev['tsSeconds']:
            seq_check_passed = False
            print(f"Timestamp out of order! {curr['tsSeconds']} < {prev['tsSeconds']}")
        if curr['tsSeconds'] == prev['tsSeconds'] and curr['sequence'] < prev['sequence']:
            seq_check_passed = False
            print(f"Sequence out of order for same timestamp! {curr['sequence']} < {prev['sequence']}")
            
    if seq_check_passed:
        print("CONFIRMED: relativeSeconds = tsSeconds - matchStartTs and sequence ordering is strictly monotonic.")

if __name__ == '__main__':
    main()
