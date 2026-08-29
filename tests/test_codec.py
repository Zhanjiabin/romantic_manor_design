# -*- coding: utf-8 -*-
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from codec.b64 import CodecError, decode, decode_kind, encode, encode_kind
from codec.ale import parse_ale, ale_to_rgba, crop_link_sprite
from codec.building import dumps_document as dumps_building_document
from codec.building import (
    format_v1,
    loads_gbk as loads_building_gbk,
    pack_desk_coordinates,
    parse_v1,
    unpack_desk_coordinates,
)
from codec.terrain import dumps_document as dumps_terrain_document
from codec.terrain import format_terrain, loads_gbk, parse_terrain
from game_paths import GAME


def test_b64_roundtrip():
    for n in (0, 1, 12, 63, 64, 130, 156, 476, 2060, 3092, 4095, 12598904):
        s = encode(n)
        assert decode(s) == n, (n, s)
    assert encode(2060, 2) == "WC"
    assert encode(3880, 2) == "wc"
    assert decode("Mk") == 1456
    assert decode("2s") == 184
    assert decode("07s") == 504
    assert encode_kind(8) == "8"
    assert encode_kind(14) == "E"
    assert encode_kind(15) == "F"
    assert encode_kind(17) == "H"
    assert decode_kind("H") == 17
    assert decode_kind("F") == 15
    assert decode_kind("8") == 8


def test_terrain_comma_roundtrip():
    stamps = [
        {"kind": "0", "x": 0, "y": 0},
        {"kind": "E", "x": 130, "y": 2694},
        {"kind": "n", "x": 4095, "y": 16},
    ]
    text = format_terrain(stamps, 2060, 0, packed=False)
    got = parse_terrain(text)
    assert got["size"] == 2060
    assert got["mapflag"] == 0
    assert got["stamps"] == stamps
    raw = text.encode("gbk")
    again = loads_gbk(raw)
    assert again["stamps"] == stamps
    assert format_terrain(again["stamps"], again["size"], again["mapflag"]) == text


def test_terrain_packed_roundtrip():
    stamps = [{"kind": "F", "x": 8, "y": 64}]
    text = format_terrain(stamps, 800, 1, packed=True)
    got = parse_terrain(text)
    assert got["stamps"] == stamps
    assert got["size"] == 800
    assert got["mapflag"] == 1


def test_manor_v1_roundtrip():
    rec = {"mode": "manor", "x": 130, "y": 2694, "item": 12598904, "dir": 0}
    text = format_v1([rec], kind="manor")
    assert text.startswith("V1;")
    got = parse_v1(text)
    assert got["kind"] == "manor"
    assert got["records"][0]["x"] == 130
    assert got["records"][0]["y"] == 2694
    assert got["records"][0]["item"] == 12598904
    assert format_v1(got["records"], kind="manor") == text


def test_desk_v1_from_mat_cfg():
    sample = "V1;0Mk2s07s1;0Tk2u07s0"
    got = parse_v1(sample)
    assert got["kind"] == "desk"
    a, b = got["records"]
    assert a["x"] == 182 and a["y"] == 184 and a["mat"] == 504 and a["state"] == 1
    assert format_v1(got["records"], kind="desk") == sample


def test_desk_coordinates_use_native_uint15_pair():
    assert unpack_desk_coordinates("0MO3g") == (179, 236)
    assert pack_desk_coordinates(179, 236) == "0MO3g"
    assert unpack_desk_coordinates(pack_desk_coordinates(32767, 32766)) == (32767, 32766)


def test_explicit_v1_kind_avoids_heuristic():
    ambiguous = "V1;000000000"
    assert parse_v1(ambiguous, kind="desk")["kind"] == "desk"
    assert parse_v1(ambiguous, kind="manor")["kind"] == "manor"
    assert parse_v1(ambiguous, kind="desk")["kindSource"] == "explicit"


def test_gbk_bytes():
    text = format_terrain([{"kind": "0", "x": 1, "y": 2}], 800, 0)
    data = text.encode("gbk")
    assert "模板" == data.decode("gbk")[:2]
    assert loads_gbk(data)["size"] == 800
    assert text.startswith("模板=(0,1,2);size=")


def test_dumps_gbk_prefix():
    data = format_terrain([{"kind": "H", "x": 185, "y": 0}], 2060, 0).encode("gbk")
    assert data[:5] == bytes([0xC4, 0xA3, 0xB0, 0xE5, 0x3D])
    assert data.decode("gbk").endswith("size=WC;mapflag=0")


def test_rejects_error_body():
    bogus = b"'latin-1' codec can't encode characters in position 43-46: ordinal not in range(256)"
    try:
        loads_gbk(bogus)
    except CodecError:
        return
    raise AssertionError("error body must not parse as a paper")


def test_matches_game_paper_tail():
    fixture = ROOT / "tests" / "fixtures" / "87terrain6.txt"
    desktop = Path(r"C:\Users\Corona\Desktop\87地形6.txt")
    raw = fixture.read_bytes() if fixture.is_file() else desktop.read_bytes()
    text = raw.decode("gbk")
    got = parse_terrain(text)
    assert got["size"] == 3880
    assert got["mapflag"] == 0
    assert got["stamps"][0]["kind"] == "H"
    assert text.startswith("模板=(")
    assert text.strip().endswith("size=wc;mapflag=0")
    roundtrip = format_terrain(got["stamps"], got["size"], got["mapflag"])
    again = parse_terrain(roundtrip)
    assert again["stamps"] == got["stamps"]
    assert again["size"] == 3880


def test_tucode_terrain_roundtrip():
    raw = Path(r"d:\game\浪漫庄园\图代码\地形.txt").read_bytes()
    text = raw.decode("gbk")
    got = parse_terrain(text)
    assert got["size"] == 3880
    assert got["mapflag"] == 0
    assert got["stamps"][0] == {"kind": "H", "x": 159, "y": 3235}
    kinds = {s["kind"] for s in got["stamps"]}
    assert kinds <= set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_`")
    assert "H" in kinds and "F" in kinds
    assert decode_kind("H") == 17
    assert decode_kind("F") == 15
    assert decode_kind("E") == 14
    assert format_terrain(got["stamps"], got["size"], got["mapflag"]) == text.strip()


def test_tucode_building_v1():
    raw = Path(r"d:\game\浪漫庄园\图代码\建筑.txt").read_bytes()
    text = raw.decode("gbk")
    got = parse_v1(text)
    assert got["kind"] == "manor"
    assert len(got["raw"]) == 1879
    assert all(len(r) == 9 for r in got["raw"])
    assert got["raw"][0] == "0ks3Q0005"
    assert got["records"][0]["x"] == 48
    assert got["records"][0]["y"] == 3587
    assert got["records"][0]["item"] == 6815744


def test_terrain_untouched_document_is_byte_exact():
    raw = b"\r\n" + "模板=(H,2V,mZ);size=wc;mapflag=0".encode("gbk") + b"\r\n"
    doc = loads_gbk(raw)
    assert dumps_terrain_document(doc) == raw
    doc["stamps"][0]["x"] += 1
    assert dumps_terrain_document(doc) != raw
    assert loads_gbk(dumps_terrain_document(doc))["stamps"][0]["x"] == 160


def test_building_untouched_document_is_byte_exact():
    raw = b"\r\nV1;0Mk2s07s1;0Tk2u07s0\r\n"
    doc = loads_building_gbk(raw, kind="desk")
    assert dumps_building_document(doc) == raw
    doc["records"][0]["x"] += 1
    changed = dumps_building_document(doc)
    assert changed != raw
    again = loads_building_gbk(changed, kind="desk")
    assert again["records"][0]["x"] == 183
    assert again["records"][1]["raw"] == "0Tk2u07s0"


def test_ale_wlink014_is_jpeg_plus_gif():
    p = GAME / "sourceCode" / "leo" / "rcex" / "maps" / "tile" / "mask" / "wlink014.ale"
    if not p.is_file():
        p = Path(r"d:\game\浪漫庄园\sourceCode\leo\rcex\maps\tile\mask\wlink014.ale")
    raw = p.read_bytes()
    doc = parse_ale(raw)
    assert doc["encrypted"]
    assert doc["blobs"][0][:3] == bytes([255, 216, 255])
    assert doc["blobs"][1][:6] == b"GIF87a"
    im = ale_to_rgba(raw)
    assert im.size == (192, 226)
    assert im.mode == "RGBA"
    cropped = crop_link_sprite(im)
    assert cropped.size[0] <= im.size[0]
    assert cropped.size[1] <= im.size[1]


def test_native_ale_container_and_frame_geometry():
    path = (
        GAME
        / "sourceCode"
        / "leo"
        / "rcex"
        / "svr"
        / "bdesign"
        / "res"
        / "antique"
        / "adornment34.ale"
    )
    doc = parse_ale(path.read_bytes())
    assert doc["format"] == "ALE"
    assert doc["version"] == 3
    assert doc["frames"] == 2
    assert doc["width"] == 69
    assert doc["height"] == 41
    frame = doc["frameTable"][0]
    assert (frame["anchorX"], frame["anchorY"]) == (-47, -25)
    assert frame["rowCount"] == frame["height"]
    image = ale_to_rgba(path.read_bytes())
    assert image.mode == "RGBA"
    assert image.size == (69, 41)
    assert image.getbbox() is not None


def test_native_v1_ale_uses_palette_and_all_frames_decode():
    path = (
        GAME
        / "sourceCode"
        / "leo"
        / "rcex"
        / "svr"
        / "bdesign"
        / "res"
        / "sea"
        / "wall_42.ale"
    )
    raw = path.read_bytes()
    doc = parse_ale(raw)
    assert doc["version"] == 1
    assert doc["frames"] == 2
    images = [ale_to_rgba(raw, frame=index) for index in range(doc["frames"])]
    assert all(image.getbbox() is not None for image in images)
    assert images[0].tobytes() != images[1].tobytes()


def test_aex_multiframe_sheet_crops_requested_frame():
    path = (
        GAME
        / "sourceCode"
        / "leo"
        / "rcex"
        / "svr"
        / "bdesign"
        / "res"
        / "antique"
        / "adornment01.ale"
    )
    raw = path.read_bytes()
    doc = parse_ale(raw)
    assert doc["format"] == "AEX"
    assert doc["frames"] == 2
    first = ale_to_rgba(raw, frame=0)
    second = ale_to_rgba(raw, frame=1)
    assert first.size == second.size == (24, 29)
    assert first.tobytes() != second.tobytes()


def test_aex_fight_header_realigns_jpeg_after_text_prefix():
    path = (
        GAME
        / "sourceCode"
        / "leo"
        / "rcitem"
        / "item_s"
        / "101normal"
        / "s1"
        / "单人沙发.ale"
    )
    raw = path.read_bytes()
    doc = parse_ale(raw)
    assert doc["format"] == "AEX"
    assert doc["blobs"][0].startswith(b"0:;dx=")
    image = ale_to_rgba(raw, frame=0)
    assert image.mode == "RGBA"
    assert image.size == (87, 65)
    assert image.getbbox() is not None
    other = ale_to_rgba(raw, frame=1)
    assert other.size == (85, 65)
    assert image.tobytes() != other.tobytes()


if __name__ == "__main__":
    tests = [v for k, v in list(globals().items()) if k.startswith("test_")]
    for fn in tests:
        fn()
        print("ok", fn.__name__)
    print("all", len(tests))
