"""Lossless building papers: ``V1;`` plus nine-character records.

Manor placement: xx(2) yy(2) item(4) dir(1)
Design-desk materials: packed x/y uint15 pair(5) mat(3) frame/state(1)

These are different formats despite sharing the same prefix and record length.
Callers that know the import context should pass ``kind="desk"`` or
``kind="manor"``.  Automatic detection is retained only for old callers and is
reported through ``kindSource``.
"""
from __future__ import annotations

from .b64 import CodecError, decode, encode


VALID_KINDS = {"desk", "manor"}
DESK_COORD_BITS = 15
DESK_COORD_MASK = (1 << DESK_COORD_BITS) - 1


def parse_v1(text: str, kind: str | None = None) -> dict:
    original = text
    normalized = text.strip().lstrip("\ufeff").replace("\r\n", "\n").replace("\r", "\n")
    if not normalized.upper().startswith("V1;"):
        raise CodecError("not a V1; building paper")
    rest = normalized[3:].strip()
    recs = [p for p in rest.split(";") if p]
    records = []
    for rec in recs:
        rec = rec.strip()
        if len(rec) != 9:
            raise CodecError("V1 record length is %d, expected 9: %r" % (len(rec), rec))
        records.append(rec)
    if kind is not None and kind not in VALID_KINDS:
        raise CodecError("unknown V1 building kind: %r" % kind)
    kind_source = "explicit" if kind else "inferred"
    kind = kind or detect_kind(records)
    parsed = [parse_record(r, kind) for r in records]
    doc = {
        "kind": kind,
        "kindSource": kind_source,
        "records": parsed,
        "raw": records,
    }
    doc["_source"] = {
        "text": original,
        "encoding": None,
        "snapshot": building_snapshot(doc),
    }
    return doc


def detect_kind(records: list[str]) -> str:
    if not records:
        return "manor"
    # Desk papers use a three-character mat.cfg key in the 1..999 range.
    # Callers should still pass an explicit kind whenever the context is known.
    try:
        mats = [decode(r[5:8]) for r in records]
    except CodecError:
        return "manor"
    if mats and sum(1 <= mat <= 999 for mat in mats) >= max(1, int(len(mats) * 0.85)):
        return "desk"
    return "manor"


def parse_record(rec: str, kind: str) -> dict:
    if kind == "desk":
        x, y = unpack_desk_coordinates(rec[:5])
        row = {
            "mode": "desk",
            "x": x,
            "y": y,
            "mat": decode(rec[5:8]),
            "state": decode(rec[8]),
            "raw": rec,
        }
        row["_rawSnapshot"] = record_snapshot(row)
        return row
    row = {
        "mode": "manor",
        "x": decode(rec[0:2]),
        "y": decode(rec[2:4]),
        "item": decode(rec[4:8]),
        "dir": decode(rec[8]),
        "raw": rec,
    }
    row["_rawSnapshot"] = record_snapshot(row)
    return row


def format_record(obj: dict) -> str:
    if obj.get("raw") and obj.get("_rawSnapshot") == record_snapshot(obj):
        return obj["raw"]
    mode = obj.get("mode") or obj.get("kind") or "manor"
    if mode == "desk":
        return (
            pack_desk_coordinates(int(obj["x"]), int(obj["y"]))
            + encode(obj["mat"], 3)
            + encode(obj.get("state", obj.get("flip", 0)), 1)
        )
    item = obj.get("item", obj.get("item", 0))
    direction = obj.get("dir", obj.get("dir", 0))
    return (
        encode(obj["x"], 2)
        + encode(obj["y"], 2)
        + encode(item, 4)
        + encode(direction, 1)
    )


def format_v1(records, kind="manor") -> str:
    recs = []
    for obj in records:
        if isinstance(obj, str):
            recs.append(obj)
        else:
            row = dict(obj)
            row.setdefault("mode", kind)
            recs.append(format_record(row))
    return "V1;" + ";".join(recs)


def dumps_gbk(records, kind="manor") -> bytes:
    return format_v1(records, kind=kind).encode("gbk")


def loads_gbk(data: bytes, kind: str | None = None) -> dict:
    for enc in ("gbk", "gb18030", "utf-8-sig", "utf-8"):
        try:
            text = data.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise CodecError("cannot decode building paper")
    doc = parse_v1(text, kind=kind)
    doc["_source"]["encoding"] = enc
    return doc


def dumps_document(doc: dict) -> bytes:
    source = doc.get("_source") or {}
    if source.get("text") is not None and source.get("snapshot") == building_snapshot(doc):
        return source["text"].encode(source.get("encoding") or "gbk")
    return dumps_gbk(doc.get("records", []), kind=doc.get("kind") or "manor")


def record_snapshot(obj: dict) -> list:
    mode = obj.get("mode") or obj.get("kind") or "manor"
    if mode == "desk":
        return [
            "desk",
            int(obj.get("x") or 0),
            int(obj.get("y") or 0),
            int(obj.get("mat") or 0),
            int(obj.get("state", obj.get("flip", 0)) or 0),
        ]
    return [
        "manor",
        int(obj.get("x") or 0),
        int(obj.get("y") or 0),
        int(obj.get("item") or 0),
        int(obj.get("dir") or 0),
    ]


def building_snapshot(doc: dict) -> dict:
    return {
        "kind": doc.get("kind") or "manor",
        "records": [record_snapshot(record) for record in doc.get("records", [])],
    }


def unpack_desk_coordinates(token: str) -> tuple[int, int]:
    if len(token) != 5:
        raise CodecError("desk coordinate token must be 5 characters")
    packed = decode(token)
    x = (packed >> DESK_COORD_BITS) & DESK_COORD_MASK
    y = packed & DESK_COORD_MASK
    return x, y


def pack_desk_coordinates(x: int, y: int) -> str:
    if not 0 <= x <= DESK_COORD_MASK or not 0 <= y <= DESK_COORD_MASK:
        raise CodecError(f"desk coordinates must fit unsigned 15-bit range: {(x, y)!r}")
    packed = (x << DESK_COORD_BITS) | y
    return encode(packed, 5)
