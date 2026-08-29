"""Lossless terrain papers: 模板=(kind,x,y,...);size=...;mapflag=....

The parsed semantic fields remain backward compatible.  ``_source`` retains
the original text/encoding and a semantic snapshot so an untouched document
can be emitted byte-for-byte instead of being normalized.
"""
from __future__ import annotations

import re

from .b64 import CodecError, decode, encode

TEMPLATE_RE = re.compile(
    r"模板\s*=\s*\((.*)\)\s*;\s*size\s*=\s*([^;]+)\s*;\s*mapflag\s*=\s*(\S+)",
    re.DOTALL | re.IGNORECASE,
)


def parse_terrain(text: str) -> dict:
    original = text
    normalized = text.strip().lstrip("\ufeff")
    m = TEMPLATE_RE.search(normalized.replace("\r\n", "\n").replace("\r", "\n"))
    if not m:
        raise CodecError("not a 模板= terrain paper")
    inner, size_tok, flag_tok = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
    flag_tok = flag_tok.rstrip(";").strip()
    stamps = _parse_inner(inner)
    doc = {
        "stamps": stamps,
        "size": decode(size_tok) if not size_tok.isdigit() else int(size_tok),
        "mapflag": decode(flag_tok) if not flag_tok.isdigit() else int(flag_tok),
        "size_token": size_tok,
        "mapflag_token": flag_tok,
    }
    doc["_source"] = {
        "text": original,
        "encoding": None,
        "lineEnding": detect_line_ending(original),
        "snapshot": terrain_snapshot(doc),
    }
    return doc


def _parse_inner(inner: str) -> list[dict]:
    inner = inner.strip()
    if not inner:
        return []
    if "," in inner:
        parts = [p.strip() for p in inner.split(",") if p.strip()]
        if len(parts) % 3 != 0:
            raise CodecError("模板= comma list is not groups of 3")
        stamps = []
        for i in range(0, len(parts), 3):
            kind, xs, ys = parts[i], parts[i + 1], parts[i + 2]
            stamps.append({"kind": kind, "x": decode(xs), "y": decode(ys)})
        return stamps
    # packed 5-char records: kind(1) + x(2) + y(2)
    compact = re.sub(r"\s+", "", inner)
    if len(compact) % 5 != 0:
        raise CodecError("packed 模板= length is not a multiple of 5")
    stamps = []
    for i in range(0, len(compact), 5):
        rec = compact[i : i + 5]
        stamps.append({"kind": rec[0], "x": decode(rec[1:3]), "y": decode(rec[3:5])})
    return stamps


def format_terrain(stamps, size, mapflag, packed=False) -> str:
    if packed:
        body = "".join(
            s["kind"] + encode(s["x"], 2) + encode(s["y"], 2) for s in stamps
        )
    else:
        bits = []
        for s in stamps:
            bits.append(s["kind"])
            bits.append(encode(s["x"]))
            bits.append(encode(s["y"]))
        body = ",".join(bits)
    return "模板=(%s);size=%s;mapflag=%s" % (
        body,
        encode(size, 2),
        encode(mapflag, 1),
    )


def dumps_gbk(stamps, size, mapflag, packed=False) -> bytes:
    return format_terrain(stamps, size, mapflag, packed=packed).encode("gbk")


def loads_gbk(data: bytes) -> dict:
    for enc in ("gbk", "gb18030", "utf-8-sig", "utf-8"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise CodecError("cannot decode terrain paper")
    doc = parse_terrain(text)
    doc["_source"]["encoding"] = enc
    return doc


def dumps_document(doc: dict, *, packed: bool | None = None) -> bytes:
    """Serialize a parsed document, preserving untouched source bytes.

    When semantic fields changed, output is canonical GBK.  Callers may force
    the compact five-character record form through ``packed``.
    """
    source = doc.get("_source") or {}
    if source.get("text") is not None and source.get("snapshot") == terrain_snapshot(doc):
        encoding = source.get("encoding") or "gbk"
        return source["text"].encode(encoding)
    if packed is None:
        packed = False
    return dumps_gbk(doc["stamps"], int(doc["size"]), int(doc.get("mapflag") or 0), packed=packed)


def terrain_snapshot(doc: dict) -> dict:
    return {
        "stamps": [
            [str(stamp["kind"]), int(stamp["x"]), int(stamp["y"])]
            for stamp in doc.get("stamps", [])
        ],
        "size": int(doc.get("size") or 0),
        "mapflag": int(doc.get("mapflag") or 0),
    }


def detect_line_ending(text: str) -> str:
    if "\r\n" in text:
        return "crlf"
    if "\r" in text:
        return "cr"
    if "\n" in text:
        return "lf"
    return "none"
