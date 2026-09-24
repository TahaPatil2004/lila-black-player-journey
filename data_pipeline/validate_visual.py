import json
import os
from pathlib import Path
from PIL import Image, ImageDraw

def validate_visual():
    data_dir = Path('public/data')
    minimaps_dir = Path('player_data/player_data/minimaps')
    output_dir = Path(os.environ.get('USERPROFILE', 'C:/Users/patil')) / '.gemini' / 'antigravity-ide' / 'brain' / '21590ffe-63e2-4cb1-a911-d30bcc674921' / 'scratch'
    output_dir.mkdir(parents=True, exist_ok=True)
    
    with open(data_dir / 'maps.json') as f:
        maps = json.load(f)
        
    with open(data_dir / 'matches.json') as f:
        matches = json.load(f)
        
    for m_cfg in maps:
        map_id = m_cfg['mapId']
        minimap_file = m_cfg['minimapFile']
        
        # Find a match for this map
        match = next((m for m in matches if m['mapId'] == map_id), None)
        if not match:
            print(f"No match found for {map_id}")
            continue
            
        print(f"Validating visual for {map_id} using match {match['matchId']}...")
        
        # Load match events
        with open(data_dir / f"matches/{match['matchId']}.json") as f:
            events = json.load(f)
            
        # Group points by user
        users = {}
        for e in events:
            if e['event'] in ['Position', 'BotPosition']:
                uid = e['userId']
                if uid not in users:
                    users[uid] = []
                users[uid].append(e['uv'])
                
        # Load map image
        img_path = minimaps_dir / minimap_file
        try:
            img = Image.open(img_path)
            draw = ImageDraw.Draw(img)
            width, height = img.size
            print(f"  Image size: {width}x{height}")
            
            # Draw lines
            colors = ["red", "blue", "green", "yellow", "cyan", "magenta", "orange", "white", "purple"]
            for i, (uid, uvs) in enumerate(users.items()):
                color = colors[i % len(colors)]
                coords = []
                for uv in uvs:
                    x = uv['u'] * width
                    # README formula for pixel Y: (1 - v) * height
                    y = (1 - uv['v']) * height
                    coords.append((x, y))
                    
                if len(coords) > 1:
                    draw.line(coords, fill=color, width=10)
                elif len(coords) == 1:
                    draw.ellipse((coords[0][0]-5, coords[0][1]-5, coords[0][0]+5, coords[0][1]+5), fill=color)
            
            out_file = output_dir / f"validation_{map_id}.png"
            # resize image down to save space for viewing
            img.thumbnail((2048, 2048))
            img.save(out_file)
            print(f"  Saved validation image to {out_file}")
        except Exception as e:
            print(f"  Error processing {map_id}: {e}")

if __name__ == '__main__':
    validate_visual()
