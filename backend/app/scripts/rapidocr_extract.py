#!/usr/bin/env python3
import json
import sys
from typing import List, Dict, Any, Tuple

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

def auto_tiles(width: int, height: int) -> Tuple[int, int]:
    ratio = width / max(1, height)
    if ratio >= 1.8:
        return (1, 2)
    if ratio <= 0.65:
        return (2, 1)
    return (2, 2)

def clamp_tiles(rows: int, cols: int, max_tiles: int) -> Tuple[int, int]:
    rows = max(1, rows)
    cols = max(1, cols)
    while rows * cols > max_tiles:
        if rows >= cols:
            rows -= 1
        else:
            cols -= 1
        rows = max(1, rows)
        cols = max(1, cols)
    return rows, cols

def tile_bounds(width: int, height: int, rows: int, cols: int, overlap: float) -> List[Tuple[int, int, int, int]]:
    rows = max(1, rows)
    cols = max(1, cols)
    overlap = max(0.0, min(0.4, overlap))
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

def stripe_bounds(width: int, height: int, stripes: int, overlap: float) -> List[Tuple[int, int, int, int]]:
    stripes = max(1, stripes)
    overlap = max(0.0, min(0.4, overlap))
    stripe_h = height / stripes
    bounds: List[Tuple[int, int, int, int]] = []
    for s in range(stripes):
        y0 = int(max(0, s * stripe_h - stripe_h * overlap))
        y1 = int(min(height, (s + 1) * stripe_h + stripe_h * overlap))
        bounds.append((0, y0, width, y1))
    return bounds

def to_bgr(image, cv2):
    if len(image.shape) == 2:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    return image

def build_variants(image, cv2):
    variants = [("orig", image)]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    try:
        clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    except Exception:
        clahe = gray
    variants.append(("clahe", to_bgr(clahe, cv2)))
    try:
        if gray.mean() < 60:
            inv_gray = 255 - clahe
            variants.append(("invert", to_bgr(inv_gray, cv2)))
    except Exception:
        pass
    try:
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
        v = hsv[:, :, 2]
        variants.append(("hsv_v", to_bgr(v, cv2)))
        g = image[:, :, 1]
        variants.append(("green", to_bgr(g, cv2)))
        try:
            lower = (35, 30, 30)
            upper = (95, 255, 255)
            mask = cv2.inRange(hsv, lower, upper)
            green_only = cv2.bitwise_and(image, image, mask=mask)
            green_gray = cv2.cvtColor(green_only, cv2.COLOR_BGR2GRAY)
            green_inv = 255 - green_gray
            variants.append(("green_mask", to_bgr(green_inv, cv2)))
        except Exception:
            pass
    except Exception:
        pass
    try:
        thresh = cv2.adaptiveThreshold(
            clahe,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            2
        )
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (2, 2))
        dilated = cv2.dilate(thresh, kernel, iterations=1)
        variants.append(("thresh", to_bgr(thresh, cv2)))
        variants.append(("thresh_dilate", to_bgr(dilated, cv2)))
        mean_val = float(gray.mean())
        if mean_val < 110:
            inv = 255 - thresh
            inv_d = cv2.dilate(inv, kernel, iterations=1)
            variants.append(("inv", to_bgr(inv, cv2)))
            variants.append(("inv_dilate", to_bgr(inv_d, cv2)))
    except Exception:
        pass
    return variants

def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({"error": "missing_path"}))
        return 1

    image_path = sys.argv[1]
    rows = parse_int(sys.argv[2], 1) if len(sys.argv) > 2 else 1
    cols = parse_int(sys.argv[3], 1) if len(sys.argv) > 3 else 1
    overlap = parse_float(sys.argv[4], 0.08) if len(sys.argv) > 4 else 0.08
    try:
        from rapidocr_onnxruntime import RapidOCR
        import cv2
    except Exception as exc:
        print(json.dumps({"error": f"rapidocr_import_failed:{exc}"}))
        return 1

    ocr = RapidOCR()
    image = cv2.imread(image_path)
    if image is None:
        print(json.dumps({"error": "image_read_failed"}))
        return 1

    height, width = image.shape[:2]
    # Crop to content bounding box to reduce empty margins
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    mean_val = float(gray.mean())
    if mean_val < 60:
        _, mask = cv2.threshold(gray, 10, 255, cv2.THRESH_BINARY)
    else:
        _, mask = cv2.threshold(gray, 245, 255, cv2.THRESH_BINARY_INV)
    coords = cv2.findNonZero(mask)
    if coords is not None:
        nonzero_ratio = float(cv2.countNonZero(mask)) / float(width * height)
        if nonzero_ratio < 0.85:
            x, y, w, h = cv2.boundingRect(coords)
            pad = int(max(8, 0.01 * max(w, h)))
            x0 = max(0, x - pad)
            y0 = max(0, y - pad)
            x1 = min(width, x + w + pad)
            y1 = min(height, y + h + pad)
            image = image[y0:y1, x0:x1]
            height, width = image.shape[:2]

    # Upscale small crops for better OCR
    max_dim = max(height, width)
    if max_dim < 1600:
        scale = 1600.0 / max_dim
        new_w = int(width * scale)
        new_h = int(height * scale)
        if new_w > 0 and new_h > 0:
            image = cv2.resize(image, (new_w, new_h), interpolation=cv2.INTER_CUBIC)
            height, width = image.shape[:2]

    if rows <= 0 or cols <= 0:
        rows, cols = auto_tiles(width, height)
        if rows * cols <= 4:
            rows = max(rows, 3)
            cols = max(cols, 2)
    rows, cols = clamp_tiles(rows, cols, max_tiles=12)
    overlap = max(0.0, min(0.25, overlap))
    tiles = tile_bounds(width, height, rows, cols, overlap)
    stripes = 0
    if rows * cols <= 6:
        stripes = max(4, min(8, int(height / 180)))
    stripe_tiles = stripe_bounds(width, height, stripes, overlap) if stripes > 0 else []

    variants = build_variants(image, cv2)
    lines: List[Dict[str, Any]] = []
    seen = set()
    for variant_label, variant_img in variants:
        for idx, (x0, y0, x1, y1) in enumerate(tiles):
            tile = variant_img[y0:y1, x0:x1]
            result, _ = ocr(tile, return_img=False)
            if not result:
                continue
            for item in result:
                try:
                    box, text, score = item
                    norm = str(text).strip().lower()
                    if not norm:
                        continue
                    key = (norm, idx, "tile")
                    if key in seen:
                        continue
                    seen.add(key)
                    lines.append({
                        "text": text,
                        "score": float(score),
                        "tile": idx,
                        "region": "tile",
                        "variant": variant_label
                    })
                except Exception:
                    continue
        for sidx, (x0, y0, x1, y1) in enumerate(stripe_tiles):
            stripe = variant_img[y0:y1, x0:x1]
            result, _ = ocr(stripe, return_img=False)
            if not result:
                continue
            for item in result:
                try:
                    box, text, score = item
                    norm = str(text).strip().lower()
                    if not norm:
                        continue
                    key = (norm, sidx, "stripe")
                    if key in seen:
                        continue
                    seen.add(key)
                    lines.append({
                        "text": text,
                        "score": float(score),
                        "tile": sidx,
                        "region": "stripe",
                        "variant": variant_label
                    })
                except Exception:
                    continue

    text_join = "\n".join([line["text"] for line in lines if line.get("text")])
    print(json.dumps({
        "text": text_join,
        "lines": lines,
        "variants": [v[0] for v in variants],
        "tiles": {"rows": rows, "cols": cols, "stripes": stripes}
    }, ensure_ascii=False))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
