"""Find GBkTile paint-related strings and xrefs in rc3.exe."""
import re
import struct
from pathlib import Path

import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()

text = [s for s in pe.sections if s.Name.startswith(b".text")][0]
text_off = text.PointerToRawData
text_end = text_off + text.SizeOfRawData
text_va = IB + text.VirtualAddress
code = data[text_off:text_end]


def off_to_va(off):
    for s in pe.sections:
        raw = s.PointerToRawData
        rsz = s.SizeOfRawData
        if raw <= off < raw + rsz:
            return IB + s.VirtualAddress + (off - raw)
    return None


print("=== GBkTile / GTile / Paint strings ===")
for m in re.finditer(
    rb"(GBkTile|GTile|GTileStore|GFullMap|GSysMap)::[\x20-\x7e]{2,90}", data
):
    va = off_to_va(m.start())
    print(f"  VA={hex(va) if va else None}  {m.group().decode()}")


def find_imm32_xrefs(target_va):
    pat = struct.pack("<I", target_va)
    xrefs = []
    p = 0
    while True:
        i = code.find(pat, p)
        if i < 0:
            break
        va = text_va + i
        prev = data[text_off + max(0, i - 8) : text_off + i + 4]
        xrefs.append((va, i, prev.hex()))
        p = i + 1
    return xrefs


print("\n=== xref counts ===")
paint_vas = []
for m in re.finditer(
    rb"(GBkTile|GTile|GTileStore)::[\x20-\x7e]{2,90}", data
):
    va = off_to_va(m.start())
    if not va:
        continue
    xr = find_imm32_xrefs(va)
    s = m.group().decode()
    print(f"  {len(xr):2d} xrefs  {hex(va)}  {s[:90]}")
    if "Paint" in s or "paint" in s:
        paint_vas.append((va, s, xr))

print("\n=== Paint xrefs detail ===")
for va, s, xr in paint_vas:
    print(s)
    for xva, i, hx in xr:
        print(f"    xref@ {hex(xva)}  bytes={hx}")
