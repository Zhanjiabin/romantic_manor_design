"""GBrushImg / GBkTileBufImg / GetTile14 strings and xrefs."""
import re
import struct
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()
text = [s for s in pe.sections if s.Name.startswith(b".text")][0]
text_off = text.PointerToRawData
text_va = IB + text.VirtualAddress
code = data[text_off : text_off + text.SizeOfRawData]


def off_to_va(off):
    for s in pe.sections:
        raw, rsz = s.PointerToRawData, s.SizeOfRawData
        if raw <= off < raw + rsz:
            return IB + s.VirtualAddress + (off - raw)
    return None


def xrefs(va):
    pat = struct.pack("<I", va)
    out = []
    p = 0
    while True:
        i = code.find(pat, p)
        if i < 0:
            break
        out.append(text_va + i)
        p = i + 1
    return out


print("=== GBrushImg / BufImg / Tile14 / mask / MakeSp ===")
for pat in [
    b"GBrushImg",
    b"GBkTileBufImg",
    b"GetTile14",
    b"Make Tile Import",
    b"__mask.jpg",
    b"MakeSp",
    b"bShowLine",
    b"SetUseBuf",
    b"sd(1)d(64)",
]:
    idx = 0
    while True:
        i = data.find(pat, idx)
        if i < 0:
            break
        # expand
        a, b = i, i
        while a > 0 and 32 <= data[a - 1] < 127:
            a -= 1
        while b < len(data) and 32 <= data[b] < 127:
            b += 1
        s = data[a:b].decode("ascii", "replace")[:100]
        va = off_to_va(a)
        xr = xrefs(va) if va else []
        print(f"  {hex(va) if va else None} nxref={len(xr)} {s}")
        if xr:
            print("    ", [hex(x) for x in xr[:8]])
        idx = i + 1

print("\n=== GBrushImg.cpp neighborhood ===")
i = data.find(b"GBrushImg.cpp")
region = data[max(0, i - 0x300) : i + 0x200]
for m in re.finditer(rb"[\x20-\x7e]{6,100}", region):
    print(" ", m.group().decode("ascii", "replace"))
