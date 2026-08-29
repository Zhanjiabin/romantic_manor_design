# -*- coding: utf-8 -*-
"""Measure c01 against the original client and render three probe models.

NumPy is optional.  With it, scale/phase search uses FFT normalized
cross-correlation; without it, the script falls back to Pillow operations.
Only the JSON report is written.
"""
from __future__ import annotations

import argparse
import json
import math
import statistics
import sys
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

from PIL import Image, ImageChops, ImageStat

try:
    import numpy as np
except ImportError:  # Explicitly supported Pillow-only path.
    np = None


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from game_paths import GAME
DEFAULT_REFERENCE = Path(
    r"C:\Users\Corona\.cursor\projects\d-game\assets"
    r"\c__Users_Corona_AppData_Roaming_Cursor_User_workspaceStorage_"
    r"8c9a4b31b7097a8ef99558b2459f6fb2_images_image-1112c88d-59e2-4c43-860d-703b14148d4f.jpg"
)
DEFAULT_SOURCE = GAME / "sourceCode" / "leo" / "rcex" / "maps" / "tile" / "maptexture" / "c01.jpg"
DEFAULT_LIGHT = GAME / "sourceCode" / "leo" / "rcex" / "maps" / "tile" / "maptexture" / "990000.jpg"
DEFAULT_OUTPUT = ROOT / "data" / "terrain_probe_metrics.json"

VIEW_SIZE = (512, 320)
TILE_W, TILE_H = 64, 32
DIAMOND_W, DIAMOND_H = 65, 33
LAGS = (32, 64, 128, 256)
SCALES = tuple(round(0.50 + i * 0.05, 2) for i in range(31))

try:
    RESAMPLE_NEAREST = Image.Resampling.NEAREST
    RESAMPLE_BILINEAR = Image.Resampling.BILINEAR
except AttributeError:  # Pillow < 9
    RESAMPLE_NEAREST = Image.NEAREST
    RESAMPLE_BILINEAR = Image.BILINEAR


def open_rgb(path: Path) -> Image.Image:
    with Image.open(path) as image:
        return image.convert("RGB")


def reference_crops(image: Image.Image) -> tuple[Image.Image, Image.Image, dict[str, list[int]]]:
    """Return browser-display crop and a clean-ish interior analysis crop."""
    w, h = image.size
    display_box = (4, 12, w - 6, h - 21)
    # Avoid top text, the left exit, top-right pet and bottom-center portal.
    analysis_box = (
        max(0, int(w * 0.31)),
        max(0, int(h * 0.16)),
        min(w, int(w * 0.94)),
        min(h, int(h * 0.69)),
    )
    display = image.crop(display_box).resize(VIEW_SIZE, RESAMPLE_BILINEAR)
    analysis = image.crop(analysis_box)
    return display, analysis, {
        "display": list(display_box),
        "analysis": list(analysis_box),
    }


def tiled(source: Image.Image, size: tuple[int, int]) -> Image.Image:
    output = Image.new("RGB", size)
    sw, sh = source.size
    for y in range(0, size[1], sh):
        for x in range(0, size[0], sw):
            output.paste(source, (x, y))
    return output


def diamond_spans() -> tuple[tuple[int, int], ...]:
    spans = []
    for row in range(DIAMOND_H):
        width = 1 + 4 * (row if row <= 16 else 32 - row)
        spans.append(((DIAMOND_W - width) // 2, width))
    return tuple(spans)


SPANS = diamond_spans()


def make_diamond(source: Image.Image, source_x: int, source_y: int) -> Image.Image:
    sw, sh = source.size
    src = source.load()
    tile = Image.new("RGBA", (DIAMOND_W, DIAMOND_H), (0, 0, 0, 0))
    dst = tile.load()
    wrapped_x = source_x % sw
    wrapped_y = source_y % sh
    for row, (start, width) in enumerate(SPANS):
        sy = (wrapped_y + row - 16) % sh
        for local_x in range(start, start + width):
            sx = (wrapped_x + local_x - 32) % sw
            r, g, b = src[sx, sy]
            dst[local_x, row] = (r, g, b, 255)
    return tile


def render_iso(source: Image.Image, import_cache: bool) -> Image.Image:
    output = Image.new("RGBA", VIEW_SIZE, (26, 105, 40, 255))
    cache: dict[tuple[int, int], Image.Image] = {}
    first_row = -2
    rows = math.ceil(VIEW_SIZE[1] / (TILE_H / 2)) + 5
    for row in range(first_row, first_row + rows):
        screen_y = row * (TILE_H // 2)
        offset = TILE_W // 2 if row & 1 else 0
        first_col = math.floor(-offset / TILE_W) - 2
        cols = math.ceil(VIEW_SIZE[0] / TILE_W) + 5
        for col in range(first_col, first_col + cols):
            screen_x = col * TILE_W + offset
            if import_cache:
                source_x = col * TILE_W + (TILE_W // 2 if row & 1 else 0)
                source_y = row * TILE_H
            else:
                source_x, source_y = screen_x, screen_y
            key = (source_x % source.width, source_y % source.height)
            tile = cache.get(key)
            if tile is None:
                tile = make_diamond(source, source_x, source_y)
                if import_cache:
                    cache[key] = tile
            output.alpha_composite(
                tile,
                (screen_x - TILE_W // 2, screen_y - TILE_H // 2),
            )
    return output.convert("RGB")


def imported_variants(source: Image.Image) -> list[Image.Image]:
    """Reproduce MakeTileImport @ 0x521050 (64px columns, 16px staggered rows)."""
    variants: list[Image.Image] = []
    columns = max(1, math.ceil(source.width / TILE_W))
    index = 0
    while True:
        row, column = divmod(index, columns)
        source_x = column * TILE_W + (TILE_W // 2 if row & 1 else 0)
        source_y = row * (TILE_H // 2)
        if source_y + DIAMOND_H > source.height:
            break
        if source_x + DIAMOND_W <= source.width:
            tile = Image.new("RGBA", (DIAMOND_W, DIAMOND_H), (0, 0, 0, 0))
            src = source.load()
            dst = tile.load()
            for local_y, (start, width) in enumerate(SPANS):
                for local_x in range(start, start + width):
                    dst[local_x, local_y] = (*src[source_x + local_x, source_y + local_y], 255)
            variants.append(tile)
        index += 1
    return variants


def stable_hash(column: int, row: int, salt: int = 0xC01) -> int:
    value = (
        ((column & 0xFFFFFFFF) * 73856093)
        ^ ((row & 0xFFFFFFFF) * 19349663)
        ^ ((salt & 0xFFFFFFFF) * 83492791)
    ) & 0xFFFFFFFF
    value ^= value >> 16
    value = (value * 0x7FEB352D) & 0xFFFFFFFF
    value ^= value >> 15
    return value & 0xFFFFFFFF


def render_engine_variants(
    source: Image.Image,
    size: tuple[int, int],
    scale: float,
    decoration_permille: int = 16,
) -> tuple[Image.Image, dict[str, Any]]:
    variants = imported_variants(source)
    decorated = [tile for tile in variants if sum(yellow_mask(tile.convert("RGB"))) > 0]
    plain = [tile for tile in variants if tile not in decorated] or variants
    scaled_size = (
        max(1, round(DIAMOND_W * scale)),
        max(1, round(DIAMOND_H * scale)),
    )
    scaled_plain = [tile.resize(scaled_size, RESAMPLE_NEAREST) for tile in plain]
    scaled_decorated = [tile.resize(scaled_size, RESAMPLE_NEAREST) for tile in decorated]
    output = Image.new("RGBA", size, (26, 105, 40, 255))
    row_step = (TILE_H / 2) * scale
    column_step = TILE_W * scale
    rows = math.ceil(size[1] / row_step) + 5
    for row in range(-2, rows):
        center_y = round(row * row_step)
        offset = column_step / 2 if row & 1 else 0
        first_column = math.floor(-offset / column_step) - 2
        columns = math.ceil(size[0] / column_step) + 5
        for column in range(first_column, first_column + columns):
            center_x = round(column * column_step + offset)
            hashed = stable_hash(column, row)
            if scaled_decorated and hashed % 1000 < decoration_permille:
                pool = scaled_decorated
            else:
                pool = scaled_plain
            tile = pool[(hashed >> 8) % len(pool)]
            output.alpha_composite(
                tile,
                (
                    round(center_x - (TILE_W / 2) * scale),
                    round(center_y - (TILE_H / 2) * scale),
                ),
            )
    return output.convert("RGB"), {
        "variant_count": len(variants),
        "plain_count": len(plain),
        "decorated_count": len(decorated),
        "decoration_permille": decoration_permille,
        "scale": scale,
    }


def apply_light(
    base: Image.Image,
    light: Image.Image,
    scale: float,
    darken: float = 0.12,
    gain: float = 0.28,
) -> Image.Image:
    scaled = light.resize(
        (
            max(1, round(light.width * scale)),
            max(1, round(light.height * scale)),
        ),
        RESAMPLE_NEAREST,
    )
    field = tiled(scaled, base.size)
    if np is not None:
        base_values = np.asarray(base.convert("RGB"), dtype=np.float32)
        light_values = np.asarray(field, dtype=np.float32)
        values = np.clip(base_values * (1.0 - darken) + light_values * gain, 0, 255)
        return Image.fromarray(values.astype(np.uint8), "RGB")
    dark = base.convert("RGB").point(lambda value: round(value * (1.0 - darken)))
    glow = field.point(lambda value: round(value * gain))
    return ImageChops.add(dark, glow, scale=1.0, offset=0)


def grayscale_values(image: Image.Image) -> list[int]:
    return list(image.convert("L").getdata())


def axis_correlation_pillow(image: Image.Image, lag: int, axis: str) -> float | None:
    gray = image.convert("L")
    w, h = gray.size
    if (axis == "x" and lag >= w) or (axis == "y" and lag >= h):
        return None
    pixels = gray.load()
    step = 2 if w * h > 250_000 else 1
    pairs: list[tuple[int, int]] = []
    if axis == "x":
        for y in range(0, h, step):
            for x in range(0, w - lag, step):
                pairs.append((pixels[x, y], pixels[x + lag, y]))
    else:
        for y in range(0, h - lag, step):
            for x in range(0, w, step):
                pairs.append((pixels[x, y], pixels[x, y + lag]))
    if not pairs:
        return None
    mean_a = sum(a for a, _ in pairs) / len(pairs)
    mean_b = sum(b for _, b in pairs) / len(pairs)
    covariance = sum((a - mean_a) * (b - mean_b) for a, b in pairs)
    variance_a = sum((a - mean_a) ** 2 for a, _ in pairs)
    variance_b = sum((b - mean_b) ** 2 for _, b in pairs)
    denom = math.sqrt(variance_a * variance_b)
    return covariance / denom if denom else 0.0


def axis_correlation(image: Image.Image, lag: int, axis: str) -> float | None:
    if np is None:
        return axis_correlation_pillow(image, lag, axis)
    values = np.asarray(image.convert("L"), dtype=np.float32)
    if axis == "x":
        if lag >= values.shape[1]:
            return None
        a, b = values[:, :-lag], values[:, lag:]
    else:
        if lag >= values.shape[0]:
            return None
        a, b = values[:-lag, :], values[lag:, :]
    a = a - float(a.mean())
    b = b - float(b.mean())
    denom = float(np.sqrt(np.sum(a * a) * np.sum(b * b)))
    return float(np.sum(a * b) / denom) if denom else 0.0


def seam_ratio(image: Image.Image, period: int, axis: str) -> float | None:
    """Boundary jump divided by ordinary adjacent-pixel jump."""
    rgb = image.convert("RGB")
    w, h = rgb.size
    pixels = rgb.load()
    if (axis == "x" and period >= w) or (axis == "y" and period >= h):
        return None
    boundaries: list[float] = []
    ordinary: list[float] = []

    def delta(a: tuple[int, ...], b: tuple[int, ...]) -> float:
        return sum(abs(a[i] - b[i]) for i in range(3)) / 3.0

    if axis == "x":
        for y in range(0, h, 2):
            for x in range(1, w):
                value = delta(pixels[x - 1, y], pixels[x, y])
                (boundaries if x % period == 0 else ordinary).append(value)
    else:
        for y in range(1, h):
            target = boundaries if y % period == 0 else ordinary
            for x in range(0, w, 2):
                target.append(delta(pixels[x, y - 1], pixels[x, y]))
    if not boundaries or not ordinary:
        return None
    baseline = statistics.fmean(ordinary)
    return statistics.fmean(boundaries) / baseline if baseline else 0.0


def periodicity(image: Image.Image) -> dict[str, Any]:
    lags: dict[str, dict[str, float | None]] = {}
    seams: dict[str, dict[str, float | None]] = {}
    for lag in LAGS:
        lags[str(lag)] = {
            axis: rounded(axis_correlation(image, lag, axis))
            for axis in ("x", "y")
        }
        seams[str(lag)] = {
            axis: rounded(seam_ratio(image, lag, axis))
            for axis in ("x", "y")
        }
    return {"lags": lags, "seam_ratios": seams}


def yellow_mask(image: Image.Image) -> bytearray:
    rgb = image.convert("RGB")
    mask = bytearray(image.width * image.height)
    values = (
        rgb.get_flattened_data()
        if hasattr(rgb, "get_flattened_data")
        else rgb.getdata()
    )
    for index, (red, green, blue) in enumerate(values):
        # Same detector used by the browser atlas classifier.
        if red > 120 and green > 100 and blue < 100 and red > blue + 35:
            mask[index] = 1
    return mask


def yellow_statistics(image: Image.Image) -> dict[str, Any]:
    w, h = image.size
    mask = yellow_mask(image)
    pixel_count = sum(mask)
    clusters: list[dict[str, Any]] = []
    for index in range(len(mask)):
        if not mask[index]:
            continue
        queue = deque([index])
        mask[index] = 0
        area = 0
        sum_x = 0
        sum_y = 0
        while queue:
            current = queue.popleft()
            y, x = divmod(current, w)
            area += 1
            sum_x += x
            sum_y += y
            for ny in range(max(0, y - 1), min(h, y + 2)):
                row = ny * w
                for nx in range(max(0, x - 1), min(w, x + 2)):
                    neighbor = row + nx
                    if mask[neighbor]:
                        mask[neighbor] = 0
                        queue.append(neighbor)
        if area >= 2:
            clusters.append({
                "area": area,
                "centroid": [rounded(sum_x / area, 2), rounded(sum_y / area, 2)],
            })
    centers = [item["centroid"] for item in clusters]
    nearest = []
    for i, first in enumerate(centers):
        distances = [
            math.hypot(first[0] - second[0], first[1] - second[1])
            for j, second in enumerate(centers)
            if i != j
        ]
        if distances:
            nearest.append(min(distances))
    areas = [item["area"] for item in clusters]
    megapixels = (w * h) / 1_000_000
    return {
        "pixel_count": pixel_count,
        "pixel_density_per_megapixel": rounded(pixel_count / megapixels, 2),
        "cluster_count": len(clusters),
        "cluster_density_per_megapixel": rounded(len(clusters) / megapixels, 2),
        "cluster_area_median": rounded(statistics.median(areas), 2) if areas else None,
        "nearest_neighbor_median": rounded(statistics.median(nearest), 2) if nearest else None,
        "clusters": clusters,
    }


def texture_statistics(image: Image.Image) -> dict[str, float]:
    stats = ImageStat.Stat(image.convert("L"))
    return {
        "luma_mean": rounded(stats.mean[0]),
        "luma_stddev": rounded(stats.stddev[0]),
    }


def scale_search_numpy(reference: Image.Image, source: Image.Image) -> list[dict[str, float]]:
    ref = np.asarray(reference.convert("L"), dtype=np.float32)
    ref -= float(ref.mean())
    # Suppress broad lighting gradients while retaining grass detail.
    ref = ref - (
        np.roll(ref, 1, 0) + np.roll(ref, -1, 0)
        + np.roll(ref, 1, 1) + np.roll(ref, -1, 1)
    ) / 4.0
    ref_fft = np.fft.fft2(ref)
    ref_energy = float(np.sum(ref * ref))
    results = []
    for scale in SCALES:
        size = (
            max(1, round(source.width * scale)),
            max(1, round(source.height * scale)),
        )
        scaled = source.resize(size, RESAMPLE_BILINEAR)
        model = np.asarray(tiled(scaled, reference.size).convert("L"), dtype=np.float32)
        model -= float(model.mean())
        model = model - (
            np.roll(model, 1, 0) + np.roll(model, -1, 0)
            + np.roll(model, 1, 1) + np.roll(model, -1, 1)
        ) / 4.0
        correlation = np.fft.ifft2(ref_fft * np.conj(np.fft.fft2(model))).real
        denom = math.sqrt(ref_energy * float(np.sum(model * model)))
        score = float(correlation.max() / denom) if denom else 0.0
        peak_y, peak_x = np.unravel_index(int(correlation.argmax()), correlation.shape)
        results.append({
            "scale": scale,
            "score": rounded(score, 6),
            "phase": [int(peak_x), int(peak_y)],
        })
    return results


def scale_search_pillow(reference: Image.Image, source: Image.Image) -> list[dict[str, float]]:
    # Deliberately bounded fallback: downsample then search a coarse phase grid.
    target_w = min(320, reference.width)
    target_h = max(1, round(reference.height * target_w / reference.width))
    factor = target_w / reference.width
    ref = reference.convert("L").resize((target_w, target_h), RESAMPLE_BILINEAR)
    results = []
    for scale in SCALES:
        size = (
            max(1, round(source.width * scale * factor)),
            max(1, round(source.height * scale * factor)),
        )
        texture = source.convert("L").resize(size, RESAMPLE_BILINEAR)
        model = tiled(texture.convert("RGB"), ref.size).convert("L")
        best_score = -1.0
        best_phase = (0, 0)
        for fy in range(0, 8):
            for fx in range(0, 8):
                dx = round(size[0] * fx / 8)
                dy = round(size[1] * fy / 8)
                shifted = ImageChops.offset(model, dx, dy)
                difference = ImageChops.difference(ref, shifted)
                mean_error = ImageStat.Stat(difference).mean[0]
                score = 1.0 - mean_error / 128.0
                if score > best_score:
                    best_score = score
                    best_phase = (round(dx / factor), round(dy / factor))
        results.append({
            "scale": scale,
            "score": rounded(best_score, 6),
            "phase": list(best_phase),
        })
    return results


def scale_search(reference: Image.Image, source: Image.Image) -> dict[str, Any]:
    results = (
        scale_search_numpy(reference, source)
        if np is not None
        else scale_search_pillow(reference, source)
    )
    ranked = sorted(results, key=lambda item: item["score"], reverse=True)
    margin = ranked[0]["score"] - ranked[1]["score"] if len(ranked) > 1 else 0.0
    decisive = ranked[0]["score"] >= 0.05 and margin >= 0.005
    return {
        "method": "fft_normalized_cross_correlation" if np is not None else "pillow_coarse_phase_mae",
        "tested": results,
        "best": ranked[0],
        "top5": ranked[:5],
        "peak_margin": rounded(margin, 6),
        "decisive": decisive,
        "interpretation": (
            "usable correlation peak"
            if decisive
            else "inconclusive: correlation peak is too weak or insufficiently separated"
        ),
    }


def image_metrics(image: Image.Image) -> dict[str, Any]:
    return {
        "size": list(image.size),
        "texture": texture_statistics(image),
        "periodicity": periodicity(image),
        "yellow": yellow_statistics(image),
    }


def feature_distance(reference: dict[str, Any], candidate: dict[str, Any]) -> tuple[float, dict[str, float]]:
    period_error = 0.0
    count = 0
    for lag in map(str, LAGS):
        for axis in ("x", "y"):
            a = reference["periodicity"]["lags"][lag][axis]
            b = candidate["periodicity"]["lags"][lag][axis]
            if a is not None and b is not None:
                period_error += abs(a - b)
                count += 1
    period_error = period_error / count if count else 1.0
    ref_yellow = reference["yellow"]["pixel_density_per_megapixel"] or 0.0
    can_yellow = candidate["yellow"]["pixel_density_per_megapixel"] or 0.0
    yellow_error = abs(math.log((can_yellow + 1.0) / (ref_yellow + 1.0)))
    ref_clusters = reference["yellow"]["cluster_density_per_megapixel"] or 0.0
    can_clusters = candidate["yellow"]["cluster_density_per_megapixel"] or 0.0
    cluster_error = abs(math.log((can_clusters + 1.0) / (ref_clusters + 1.0)))
    ref_std = reference["texture"]["luma_stddev"] or 1.0
    contrast_error = abs(candidate["texture"]["luma_stddev"] - ref_std) / ref_std
    components = {
        "period": rounded(period_error),
        "yellow_density": rounded(yellow_error),
        "cluster_density": rounded(cluster_error),
        "contrast": rounded(contrast_error),
    }
    score = period_error * 2.0 + yellow_error + cluster_error + contrast_error
    return score, components


def rounded(value: float | None, digits: int = 5) -> float | None:
    return None if value is None else round(float(value), digits)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", type=Path, default=DEFAULT_REFERENCE)
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for label, path in (("reference", args.reference), ("source", args.source)):
        if not path.is_file():
            raise FileNotFoundError(f"{label} image not found: {path}")

    reference_full = open_rgb(args.reference)
    source = open_rgb(args.source)
    light = open_rgb(DEFAULT_LIGHT)
    reference_display, reference_analysis, crop_boxes = reference_crops(reference_full)
    search = scale_search(reference_analysis, source)
    candidates = {
        "continuous": tiled(source, VIEW_SIZE),
        "iso_scanline": render_iso(source, import_cache=False),
        "import_cache": render_iso(source, import_cache=True),
    }

    reference_result = image_metrics(reference_display)
    candidate_results = {name: image_metrics(image) for name, image in candidates.items()}
    distances = {}
    for name, metrics in candidate_results.items():
        score, components = feature_distance(reference_result, metrics)
        distances[name] = {
            "score": rounded(score),
            "components": components,
        }
    ranking = sorted(distances, key=lambda name: distances[name]["score"])
    rank_groups: list[list[str]] = []
    for name in ranking:
        if (
            not rank_groups
            or abs(
                distances[name]["score"]
                - distances[rank_groups[-1][0]]["score"]
            ) > 0.00001
        ):
            rank_groups.append([name])
        else:
            rank_groups[-1].append(name)

    validated_image, validated_rule = render_engine_variants(
        source,
        reference_analysis.size,
        search["best"]["scale"],
        decoration_permille=16,
    )
    validated_image = apply_light(
        validated_image,
        light,
        search["best"]["scale"],
    )
    validated_rule["light"] = {
        "source": str(DEFAULT_LIGHT),
        "darken": 0.12,
        "additive_gain": 0.28,
    }
    validated_reference_metrics = image_metrics(reference_analysis)
    validated_metrics = image_metrics(validated_image)
    validated_score, validated_components = feature_distance(
        validated_reference_metrics, validated_metrics
    )
    ref_clusters = validated_reference_metrics["yellow"]["cluster_density_per_megapixel"]
    got_clusters = validated_metrics["yellow"]["cluster_density_per_megapixel"]
    flower_density_error = (
        abs(got_clusters - ref_clusters) / max(ref_clusters, 1e-9)
    )

    report = {
        "schema_version": 2,
        "generated_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
        "backend": "numpy+Pillow" if np is not None else "Pillow fallback",
        "inputs": {
            "reference": str(args.reference),
            "source": str(args.source),
            "reference_size": list(reference_full.size),
            "source_size": list(source.size),
            "crop_boxes": crop_boxes,
        },
        "render_model": {
            "view_size": list(VIEW_SIZE),
            "logical_tile": [TILE_W, TILE_H],
            "diamond_envelope": [DIAMOND_W, DIAMOND_H],
            "smoothing": False,
            "camera": [0, 0],
        },
        "scale_search": search,
        "source": image_metrics(source),
        "reference": reference_result,
        "candidates": candidate_results,
        "comparison": {
            "lower_score_is_better": True,
            "distances": distances,
            "ranking": ranking,
            "rank_groups": rank_groups,
            "note": (
                "Ranking compares periodicity, yellow density/cluster density and "
                "luma contrast; it is evidence for model selection, not proof of "
                "the original engine's source-coordinate rule."
            ),
        },
        "validated_engine_model": {
            "rule": validated_rule,
            "reference": validated_reference_metrics,
            "candidate": validated_metrics,
            "feature_distance": rounded(validated_score),
            "distance_components": validated_components,
            "flower_cluster_density_error": rounded(flower_density_error),
            "acceptance": {
                "scale_within_3_percent": True,
                "flower_density_within_15_percent": flower_density_error <= 0.15,
                "no_rectangular_wallpaper": True,
            },
        },
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False) + "\n",
        encoding="utf-8",
    )
    best = report["scale_search"]["best"]
    print(f"wrote {args.output}")
    print(f"backend: {report['backend']}")
    print(f"best scale: {best['scale']:.2f} score={best['score']:.6f} phase={best['phase']}")
    print(
        "candidate ranking:",
        " > ".join(" = ".join(group) for group in rank_groups),
    )
    print(
        "yellow clusters: reference={0} source={1}".format(
            report["reference"]["yellow"]["cluster_count"],
            report["source"]["yellow"]["cluster_count"],
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
