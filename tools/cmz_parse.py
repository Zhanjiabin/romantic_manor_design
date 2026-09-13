# -*- coding: utf-8 -*-
"""Parse Romantic Manor CMZ (Cal3D-derived) meshes for clothing try-on."""
from __future__ import annotations

import json
import math
import struct
from dataclasses import dataclass, field
from pathlib import Path
from typing import BinaryIO

UV_SCALE = 2.0 / 65535.0
NRM_SCALE = 2.0 / 65535.0
WEIGHT_SCALE = 1e-4


class CMZError(ValueError):
    pass


class Cursor:
    def __init__(self, data: bytes, pos: int = 0) -> None:
        self.data = data
        self.pos = pos

    def remaining(self) -> int:
        return len(self.data) - self.pos

    def u8(self) -> int:
        if self.pos >= len(self.data):
            raise CMZError("eof u8")
        v = self.data[self.pos]
        self.pos += 1
        return v

    def u16(self) -> int:
        if self.pos + 2 > len(self.data):
            raise CMZError("eof u16")
        v = struct.unpack_from("<H", self.data, self.pos)[0]
        self.pos += 2
        return v

    def i32(self) -> int:
        if self.pos + 4 > len(self.data):
            raise CMZError("eof i32")
        v = struct.unpack_from("<i", self.data, self.pos)[0]
        self.pos += 4
        return v

    def u32(self) -> int:
        return self.i32() & 0xFFFFFFFF

    def f32(self) -> float:
        if self.pos + 4 > len(self.data):
            raise CMZError("eof f32")
        v = struct.unpack_from("<f", self.data, self.pos)[0]
        self.pos += 4
        return v

    def strz(self) -> str:
        n = self.u32()
        if n < 0 or self.pos + n > len(self.data):
            raise CMZError(f"bad str len {n}")
        raw = self.data[self.pos : self.pos + n]
        self.pos += n
        return raw.split(b"\x00", 1)[0].decode("latin1")


@dataclass
class Submesh:
    name: str
    material_id: int
    positions: list[list[float]]
    normals: list[list[float]]
    uvs: list[list[float]]
    faces: list[list[int]]
    influences: list[list[tuple[int, float]]] = field(default_factory=list)


@dataclass
class Mesh:
    name: str
    submeshes: list[Submesh]


@dataclass
class MapSlot:
    name: str
    file: str


@dataclass
class CMZModel:
    meshes: list[Mesh]
    maps: list[MapSlot]


def _parse_submesh(c: Cursor, mesh_name: str) -> Submesh:
    tag = c.u32()
    if tag != 0x73756273:
        raise CMZError(f"expected sbus got {tag:#x} at {c.pos-4}")
    material_id = c.i32()
    nverts = c.i32()
    wide = False
    if nverts == 0:
        ver = c.u8()
        if ver != 1:
            raise CMZError(f"submesh ver {ver}")
        nverts = c.i32()
        wide = True  # versioned files then have the wide-bones flag after header
    nfaces = c.i32()
    lod = c.i32()
    springs = c.i32()
    nuv = c.i32()
    if wide:
        bone_wide = c.u8() != 0
    else:
        bone_wide = False
    xmin, xscale = c.f32(), c.f32()
    ymin, yscale = c.f32(), c.f32()
    zmin, zscale = c.f32(), c.f32()

    positions: list[list[float]] = []
    normals: list[list[float]] = []
    uvs: list[list[float]] = []
    influences: list[list[tuple[int, float]]] = []

    for _ in range(nverts):
        px = c.u16() * xscale + xmin
        py = c.u16() * yscale + ymin
        pz = c.u16() * zscale + zmin
        nx = c.u16() * NRM_SCALE - 1.0
        ny = c.u16() * NRM_SCALE - 1.0
        nz = c.u16() * NRM_SCALE - 1.0
        uv = [0.0, 0.0]
        for ui in range(max(nuv, 0)):
            u = c.u16() * UV_SCALE
            v = c.u16() * UV_SCALE
            if ui == 0:
                uv = [u, v]
        if bone_wide:
            ninf = c.u16()
        else:
            ninf = c.u8()
        inf: list[tuple[int, float]] = []
        for _i in range(ninf):
            bone = c.u16() if bone_wide else c.u8()
            w = c.u16() * WEIGHT_SCALE
            inf.append((bone, w))
        if springs > 0:
            c.f32()
        positions.append([px, py, pz])
        normals.append([nx, ny, nz])
        uvs.append(uv)
        influences.append(inf)

    for _ in range(springs):
        c.i32()
        c.i32()
        c.f32()
        c.f32()

    faces: list[list[int]] = []
    packed = nverts < 0x400
    for _ in range(nfaces):
        if packed:
            p = c.u32()
            v2 = p & 0x3FF
            v1 = (p >> 10) & 0x3FF
            v0 = (p >> 20) & 0x3FF
        else:
            v0, v1, v2 = c.u16(), c.u16(), c.u16()
        faces.append([v0, v1, v2])

    # skip leftover lod records if present (rarely used)
    _ = lod
    return Submesh(
        name=mesh_name,
        material_id=material_id,
        positions=positions,
        normals=normals,
        uvs=uvs,
        faces=faces,
        influences=influences,
    )


def parse_cmz(path: Path) -> CMZModel:
    data = path.read_bytes()
    if data[:4] != b"CMZ\x00":
        raise CMZError(f"not CMZ: {path}")
    mesh_off = data.find(b"HSEM")
    if mesh_off < 0:
        raise CMZError("no HSEM")
    c = Cursor(data, mesh_off + 4)
    nmesh = c.i32()
    meshes: list[Mesh] = []
    for _ in range(nmesh):
        name = c.strz()
        nsub = c.i32()
        if nsub < 1 or nsub > 64:
            # some files store a flag=1 then sbus without extra name
            c.pos -= 4
            nsub = 1
        subs = []
        for _s in range(nsub):
            # peek: if next is sbus, submesh has no extra name
            if c.remaining() >= 4 and struct.unpack_from("<I", c.data, c.pos)[0] == 0x73756273:
                subs.append(_parse_submesh(c, name))
            else:
                subname = c.strz()
                subs.append(_parse_submesh(c, subname or name))
        meshes.append(Mesh(name=name, submeshes=subs))

    maps: list[MapSlot] = []
    map_off = data.find(b"1PAM")
    if map_off >= 0:
        m = Cursor(data, map_off + 4)
        nmap = m.u16() if False else m.i32()
        # hex: 1PAM 01 00 07 00 00 00 tou_bq — could be u16 nmap=1 then namelen
        # retry from map_off+4
        c2 = Cursor(data, map_off + 4)
        # try u32 nmap
        n = c2.i32()
        if 1 <= n <= 16:
            for _ in range(n):
                slot = c2.strz()
                # trailing fields until next string or END
                # hex after tou_bq: 00 00 01 68 60 88 01 43 00 00 00 d6 ce 12 00 00 00 g_tou_bq_1_00.jpg
                # skip unknowns until we see a plausible filename length
                # Simpler: scan remaining MAP1 for .jpg
        # filename scan
        region = data[map_off : data.find(b".DNE") if data.find(b".DNE") >= 0 else len(data)]
        import re

        for mobj in re.finditer(rb"([a-zA-Z0-9_\-]+\.(?:jpg|png|tga))", region):
            maps.append(MapSlot(name=mobj.group(1).decode("latin1"), file=mobj.group(1).decode("latin1")))

    return CMZModel(meshes=meshes, maps=maps)


def bbox(sub: Submesh) -> tuple[list[float], list[float]]:
    xs, ys, zs = zip(*sub.positions)
    return [min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)]


def write_obj(sub: Submesh, path: Path) -> None:
    lines = [f"# {sub.name} v={len(sub.positions)} f={len(sub.faces)}"]
    for p in sub.positions:
        lines.append(f"v {p[0]:.6f} {p[1]:.6f} {p[2]:.6f}")
    for uv in sub.uvs:
        lines.append(f"vt {uv[0]:.6f} {1.0 - uv[1]:.6f}")
    for n in sub.normals:
        lines.append(f"vn {n[0]:.6f} {n[1]:.6f} {n[2]:.6f}")
    for f in sub.faces:
        a, b, cidx = (i + 1 for i in f)
        lines.append(f"f {a}/{a}/{a} {b}/{b}/{b} {cidx}/{cidx}/{cidx}")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    files = [
        Path(r"D:\game\浪漫庄园\sourceCode\leo\rcex\act\g_cmz\head\nol\g_head.cmz"),
        Path(r"D:\game\浪漫庄园\sourceCode\leo\rcex\act\g_cmz\toushi\nol\g_toushi_c.cmz"),
        Path(r"D:\game\浪漫庄园\sourceCode\leo\rcex\act\g_cmz\body\nol\g_yifu.cmz"),
        Path(r"D:\game\浪漫庄园\sourceCode\leo\rcitem\pc\g_cmz\body\diy_1\g_yifu.cmz"),
        Path(r"D:\game\浪漫庄园\sourceCode\leo\rcitem\pc\g_cmz\body\diy_2\g_yifu.cmz"),
        Path(r"D:\game\浪漫庄园\sourceCode\leo\rcitem\pc\g_cmz\body\diy_3\g_yifu.cmz"),
    ]
    for path in files:
        print("=" * 60)
        print(path)
        try:
            model = parse_cmz(path)
        except Exception as exc:
            print("FAIL", type(exc).__name__, exc)
            continue
        for mesh in model.meshes:
            for sub in mesh.submeshes:
                lo, hi = bbox(sub)
                print(
                    f"  {mesh.name}/{sub.name} mat={sub.material_id} v={len(sub.positions)} "
                    f"f={len(sub.faces)} uv0={sub.uvs[0] if sub.uvs else None} "
                    f"bbox={lo}..{hi} inf0={sub.influences[0][:4] if sub.influences else None}"
                )
                bad = sum(1 for f in sub.faces if max(f) >= len(sub.positions) or min(f) < 0)
                print("   bad_faces", bad)


if __name__ == "__main__":
    main()
