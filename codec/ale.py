"""GBox ALE containers.

``AEX\0`` stores encrypted JPEG/GIF planes and is fully decoded here.
Some furniture AEX files prefix the planes with a text header
(``0:;dx=...;fight=true``) and encrypt that header as its own key stream.
The JPEG/GIF that follows is encrypted again from key offset 0; if the
header length is not a multiple of 8, a single pass over the concatenated
blob misaligns the image.  ``ale_to_rgba`` splits and re-decrypts those
planes.

``ALE\0`` stores the older row-compressed sprite representation.  Its
container and frame geometry are parsed losslessly; pixel expansion remains a
separate decoder because it uses the native GBox row command stream.
"""
from __future__ import annotations

import io
import re
import struct
from pathlib import Path

MAGIC = b"AEX\x00"
NATIVE_MAGIC = b"ALE\x00"
PLAIN_KEY = b"00000000"


class AleError(ValueError):
    pass


def _sub_key(data: bytes, key: bytes) -> bytes:
    if not key:
        return data
    n = len(key)
    return bytes((data[i] - key[i % n]) & 255 for i in range(len(data)))


def _add_key(data: bytes, key: bytes) -> bytes:
    if not key:
        return data
    n = len(key)
    return bytes((data[i] + key[i % n]) & 255 for i in range(len(data)))


_FIGHT_LINE = re.compile(rb"^\d+:;")


def _fight_header_length(blob: bytes) -> int:
    """Return the byte length of a ``N:;dx=...;fight=true`` prefix, or 0."""
    if not blob.startswith(b"0:;"):
        return 0
    position = 0
    while position < len(blob):
        newline = blob.find(b"\n", position)
        if newline < 0:
            break
        line = blob[position : newline + 1]
        if not _FIGHT_LINE.match(line):
            break
        position = newline + 1
    return position


def _unwrap_fight_planes(blobs: list[bytes], key: bytes) -> list[bytes]:
    """Re-decrypt JPEG/GIF tails that follow an independently keyed text header."""
    if not blobs or not key:
        return blobs
    header_len = _fight_header_length(blobs[0])
    if header_len <= 0:
        return blobs
    out = []
    for blob in blobs:
        if not blob or len(blob) <= header_len:
            out.append(blob)
            continue
        encrypted = _add_key(blob, key)
        out.append(_sub_key(encrypted[header_len:], key))
    return out


def parse_ale(data: bytes) -> dict:
    if data.startswith(NATIVE_MAGIC):
        return _parse_native_ale(data)
    if not data.startswith(MAGIC):
        raise AleError("not an ALE/AEX file")
    key = data[4:12]
    if len(key) < 8:
        raise AleError("truncated AEX header")
    if len(data) < 32:
        raise AleError("truncated AEX header")
    frames, kind, size_a, size_b, size_c = struct.unpack_from("<IIIII", data, 12)
    table = frames * 24
    off = 32 + table
    encrypted = key != PLAIN_KEY
    blobs = []
    for sz in (size_a, size_b, size_c):
        if sz <= 0:
            blobs.append(b"")
            continue
        chunk = data[off : off + sz]
        if len(chunk) != sz:
            raise AleError("truncated AEX payload")
        blobs.append(_sub_key(chunk, key) if encrypted else chunk)
        off += sz
    width = height = 0
    frame_table = []
    if table >= 8:
        width, height = struct.unpack_from("<II", data, 32)
    for index in range(frames):
        position = 32 + index * 24
        fw, fh, value_a, value_b, anchor_x, anchor_y = struct.unpack_from(
            "<IIIIii", data, position
        )
        frame_table.append(
            {
                "index": index,
                "width": fw,
                "height": fh,
                "valueA": value_a,
                "valueB": value_b,
                "anchorX": anchor_x,
                "anchorY": anchor_y,
            }
        )
    return {
        "format": "AEX",
        "decodable": True,
        "key": key,
        "encrypted": encrypted,
        "frames": frames,
        "kind": kind,
        "width": width,
        "height": height,
        "frameTable": frame_table,
        "blobs": blobs,
    }


def _parse_native_ale(data: bytes) -> dict:
    if len(data) < 12:
        raise AleError("truncated native ALE header")
    version = struct.unpack_from("<H", data, 4)[0]
    payload_size = struct.unpack_from("<I", data, 6)[0]
    frame_count = struct.unpack_from("<H", data, 10)[0]
    position = 12
    palette = b""
    transparent_color = None
    if version == 1:
        if len(data) < position + 1024:
            raise AleError("truncated native ALE palette")
        palette = data[position : position + 1024]
        position += 1024
    elif version == 2:
        if len(data) < position + 4:
            raise AleError("truncated native ALE transparent color")
        transparent_color = struct.unpack_from("<I", data, position)[0]
        position += 4

    frames = []
    for index in range(frame_count):
        if position + 4 > len(data):
            raise AleError("truncated native ALE frame table")
        frame_size = struct.unpack_from("<I", data, position)[0]
        if frame_size < 24 or position + frame_size > len(data):
            raise AleError(
                "invalid native ALE frame %d size %d at %d" % (index, frame_size, position)
            )
        prefix_length, width, height, anchor_x, anchor_y = struct.unpack_from(
            "<IIIii", data, position + 4
        )
        stream_offset = position + 24 + prefix_length
        if stream_offset + 2 > position + frame_size:
            raise AleError(f"native ALE frame {index} prefix exceeds frame")
        row_count = struct.unpack_from("<H", data, stream_offset)[0]
        frames.append(
            {
                "index": index,
                "offset": position,
                "size": frame_size,
                "prefixLength": prefix_length,
                "width": width,
                "height": height,
                "anchorX": anchor_x,
                "anchorY": anchor_y,
                "rowCount": row_count,
                "streamOffset": stream_offset,
                "streamSize": position + frame_size - stream_offset,
            }
        )
        position += frame_size

    trailer = data[position:]
    first = next((frame for frame in frames if frame["width"] and frame["height"]), None)
    return {
        "format": "ALE",
        "decodable": True,
        "version": version,
        "payloadSize": payload_size,
        "frames": frame_count,
        "frameTable": frames,
        "width": first["width"] if first else 0,
        "height": first["height"] if first else 0,
        "palette": palette,
        "transparentColor": transparent_color,
        "trailerOffset": position,
        "trailer": trailer,
        "blobs": [],
    }


def _open_image(blob: bytes):
    from PIL import Image, ImageFile

    if not blob:
        return None
    # A few fight-header JPEGs are missing the last 20–30 bytes.
    previous = ImageFile.LOAD_TRUNCATED_IMAGES
    ImageFile.LOAD_TRUNCATED_IMAGES = True
    try:
        im = Image.open(io.BytesIO(blob))
        im.load()
        return im
    except (OSError, ValueError):
        return None
    finally:
        ImageFile.LOAD_TRUNCATED_IMAGES = previous


def ale_to_rgba(data: bytes, frame: int = 0):
    """Return a PIL RGBA image (JPEG color × GIF/L mask)."""
    from PIL import Image

    doc = parse_ale(data)
    if doc["format"] == "ALE":
        return _native_ale_to_rgba(data, doc, frame)
    planes = []
    for blob in _unwrap_fight_planes(list(doc["blobs"]), doc.get("key") or b""):
        im = _open_image(blob)
        if im is None:
            continue
        planes.append(im)
    if not planes:
        raise AleError("AEX has no decodable image plane")
    color = planes[0]
    mask = planes[1].convert("L") if len(planes) > 1 else None
    rgba = color.convert("RGBA")
    if mask is not None:
        if mask.size != rgba.size:
            mask = mask.resize(rgba.size)
        rgba.putalpha(mask)
    frames = doc.get("frameTable") or []
    if frames:
        if frame < 0 or frame >= len(frames):
            raise AleError("AEX frame index out of range")
        info = frames[frame]
        left = int(info.get("valueA") or 0)
        top = int(info.get("valueB") or 0)
        width = int(info.get("width") or rgba.width)
        height = int(info.get("height") or rgba.height)
        box = (left, top, left + width, top + height)
        # A handful of shipped sheets trim fully-transparent edge rows/columns.
        # Copying the intersection onto a transparent frame matches that clipping.
        clipped = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        source_box = (
            max(0, left),
            max(0, top),
            min(rgba.width, left + width),
            min(rgba.height, top + height),
        )
        if source_box[0] < source_box[2] and source_box[1] < source_box[3]:
            clipped.paste(
                rgba.crop(source_box),
                (max(0, -left), max(0, -top)),
            )
        rgba = clipped
    return rgba


def _native_ale_to_rgba(data: bytes, doc: dict, frame_index: int):
    from PIL import Image

    frames = doc["frameTable"]
    if frame_index < 0 or frame_index >= len(frames):
        raise AleError("native ALE frame index out of range")
    frame = frames[frame_index]
    width, height = frame["width"], frame["height"]
    if width <= 0 or height <= 0:
        raise AleError("native ALE frame has invalid geometry")
    image = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    pixels = image.load()
    position = frame["streamOffset"]
    frame_end = frame["offset"] + frame["size"]
    if position + 2 > frame_end:
        raise AleError("truncated native ALE row stream")
    row_records = struct.unpack_from("<H", data, position)[0]
    position += 2
    skipped_rows = 0

    for record_index in range(row_records):
        if position + 2 > frame_end:
            raise AleError("truncated native ALE row header")
        segment_count = struct.unpack_from("<H", data, position)[0]
        position += 2
        while segment_count & 0xC000:
            skipped_rows += (-segment_count) & 0xFFFF
            if position + 2 > frame_end:
                raise AleError("truncated native ALE row skip")
            segment_count = struct.unpack_from("<H", data, position)[0]
            position += 2
        if position + 2 > frame_end:
            raise AleError("truncated native ALE row length")
        row_size = struct.unpack_from("<H", data, position)[0]
        position += 2
        row_end = position + row_size
        if row_end > frame_end:
            raise AleError("native ALE row exceeds frame")
        y = skipped_rows + record_index
        if 0 <= y < height:
            try:
                _decode_native_row(
                    data,
                    position,
                    row_end,
                    segment_count,
                    pixels,
                    y,
                    width,
                    doc["version"],
                    doc.get("palette") or b"",
                )
            except AleError as exc:
                raise AleError(
                    f"{exc}; frame={frame_index} row={y} offset={position} size={row_size}"
                ) from exc
        position = row_end
    return image


def _decode_native_row(
    data, position, row_end, segment_count, pixels, y, width, version, palette
):
    bytes_per_pixel = 1 if version == 1 else 2

    def read_color():
        nonlocal position
        if version == 1:
            if position >= row_end:
                raise AleError("truncated native ALE palette pixel")
            index = data[position]
            position += 1
            blue, green, red, _ = palette[index * 4 : index * 4 + 4]
            return red, green, blue
        if position + 2 > row_end:
            raise AleError("truncated native ALE RGB565 pixel")
        color = struct.unpack_from("<H", data, position)[0]
        position += 2
        return _rgb565(color)

    x = 0
    for _ in range(segment_count):
        if position + 2 > row_end:
            break
        x += data[position]
        code = data[position + 1]
        position += 2
        if x >= width:
            break
        while True:
            if code < 0x80:
                count = code
                byte_count = count * bytes_per_pixel
                if position + byte_count > row_end:
                    count = min(count, (row_end - position) // bytes_per_pixel)
                for _ in range(count):
                    if 0 <= x < width:
                        pixels[x, y] = (*read_color(), 255)
                    else:
                        read_color()
                    x += 1
                break

            command = (code >> 5) & 0x03
            amount = code & 0x1F
            if command == 1:
                # The engine's hit-test reports these pixels at alpha 0x80.
                for _ in range(amount):
                    if 0 <= x < width:
                        pixels[x, y] = (0, 0, 0, 128)
                    x += 1
                break
            if command in (2, 3):
                if position + bytes_per_pixel > row_end:
                    break
                if 0 <= x < width:
                    pixels[x, y] = (*read_color(), min(255, amount << 3))
                else:
                    read_color()
                x += 1
                if command == 2:
                    break
                if position >= row_end:
                    break
                code = data[position]
                position += 1
                continue
            # 0x80..0x9f is an empty/end command.
            break


def _rgb565(value: int) -> tuple[int, int, int]:
    red = (value >> 11) & 0x1F
    green = (value >> 5) & 0x3F
    blue = value & 0x1F
    return (
        (red << 3) | (red >> 2),
        (green << 2) | (green >> 4),
        (blue << 3) | (blue >> 2),
    )


def dumps_png(data: bytes, frame: int = 0, crop: bool = True, trim: bool = False) -> bytes:
    buf = io.BytesIO()
    image = ale_to_rgba(data, frame=frame)
    if crop:
        image = crop_link_sprite(image)
    elif trim:
        image = trim_opaque(image)
    image.save(buf, format="PNG")
    return buf.getvalue()


def trim_opaque(im, pad: int = 2):
    bbox = im.getbbox()
    if not bbox:
        return im
    left, top, right, bottom = bbox
    left = max(0, left - pad)
    top = max(0, top - pad)
    right = min(im.size[0], right + pad)
    bottom = min(im.size[1], bottom + pad)
    if right - left < 2 or bottom - top < 2:
        return im
    return im.crop((left, top, right, bottom))


def crop_link_sprite(im):
    """Pick the 2:1 iso diamond hole in a link ALE and crop the framed tile around it."""
    w, h = im.size
    px = im.load()
    vis = [[0] * w for _ in range(h)]
    holes = []

    def walk(sx, sy):
        stack = [(sx, sy)]
        vis[sy][sx] = 1
        cells = []
        while stack:
            x, y = stack.pop()
            cells.append((x, y))
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and not vis[ny][nx] and px[nx, ny][3] < 40:
                    vis[ny][nx] = 1
                    stack.append((nx, ny))
        return cells

    for y in range(h):
        for x in range(w):
            if vis[y][x] or px[x, y][3] >= 40:
                continue
            cells = walk(x, y)
            if len(cells) < 200:
                continue
            xs = [c[0] for c in cells]
            ys = [c[1] for c in cells]
            bw = max(xs) - min(xs) + 1
            bh = max(ys) - min(ys) + 1
            aspect = bw / max(bh, 1)
            score = abs(aspect - 2.0)
            if 1.5 <= aspect <= 2.6 and 800 <= len(cells) <= 8000:
                holes.append((score, min(xs), min(ys), bw, bh))
    if not holes:
        return im
    holes.sort()
    _, x0, y0, bw, bh = holes[0]
    pad_x = max(12, int(bw * 0.28))
    pad_y = max(8, int(bh * 0.28))
    left = max(0, x0 - pad_x)
    top = max(0, y0 - pad_y)
    right = min(w, x0 + bw + pad_x)
    bot = min(h, y0 + bh + pad_y)
    return im.crop((left, top, right, bot))


def load_ale(path: str | Path):
    return ale_to_rgba(Path(path).read_bytes())


if __name__ == "__main__":
    import sys

    src = Path(sys.argv[1]) if len(sys.argv) > 1 else Path()
    if src.is_file():
        out = src.with_suffix(".png")
        out.write_bytes(dumps_png(src.read_bytes()))
        print("wrote", out)
    else:
        sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
        from game_paths import TILE

        folder = TILE / "mask"
        dest = Path(__file__).resolve().parents[1] / "data" / "ale_png"
        dest.mkdir(parents=True, exist_ok=True)
        n = 0
        for f in sorted(folder.glob("*.ale")):
            (dest / (f.stem + ".png")).write_bytes(dumps_png(f.read_bytes()))
            n += 1
        print("wrote", n, "png ->", dest)
