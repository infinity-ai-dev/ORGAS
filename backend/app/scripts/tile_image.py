#!/usr/bin/env python3
import json
import os
import sys
from typing import List, Tuple

def parse_int(value: str, fallback: int) -> int:
    try:
        return int(value)
    except Exception:
        return fallback

def parse_float(value: str, fallback: float) -> float:
    try:
        return float(value)
    except Exception:
        return fallback

def clamp_overlap(value: float) -> float:
    if value < 0.0:
        return 0.0
    if value > 0.25:
        return 0.25
    return value

def tile_bounds(width: int, height: int, rows: int, cols: int, overlap: float) -> List[Tuple[int, int, int, int]]:
    rows = max(1, rows)
    cols = max(1, cols)
    overlap = clamp_overlap(overlap)
    tile_w = width / cols
    tile_h = height / rows
    bounds: List[Tuple[int, int, int, int]] = []
    for r in range(rows):
        for c in range(cols):
            x0 = int(max(0, c * tile_w - tile_w * overlap))
            y0 = int(max(0, r * tile_h - tile_h * overlap))
            x1 = int(min(width, (c + 1) * tile_w + tile_w * overlap))
            y1 = int(min(height, (r + 1) * tile_h + tile_h * overlap))
            bounds.append((x0, y0, x1, y1))
    return bounds

def main() -> int:
    if len(sys.argv) < 3:
        print(json.dumps({"error": "missing_args"}))
        return 1
    input_path = sys.argv[1]
    out_dir = sys.argv[2]
    rows = parse_int(sys.argv[3], 2) if len(sys.argv) > 3 else 2
    cols = parse_int(sys.argv[4], 2) if len(sys.argv) > 4 else 2
    overlap = parse_float(sys.argv[5], 0.08) if len(sys.argv) > 5 else 0.08

    try:
        from PIL import Image
    except Exception as exc:
        print(json.dumps({"error": f"pil_import_failed:{exc}"}))
        return 1

    try:
        image = Image.open(input_path)
    except Exception as exc:
        print(json.dumps({"error": f"image_open_failed:{exc}"}))
        return 1

    os.makedirs(out_dir, exist_ok=True)
    width, height = image.size
    bounds = tile_bounds(width, height, rows, cols, overlap)
    tiles: List[str] = []
    for idx, (x0, y0, x1, y1) in enumerate(bounds):
        tile = image.crop((x0, y0, x1, y1))
        name = f"tile-{idx + 1}.png"
        path = os.path.join(out_dir, name)
        tile.save(path, format="PNG")
        tiles.append(name)

    print(json.dumps({"tiles": tiles}))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
