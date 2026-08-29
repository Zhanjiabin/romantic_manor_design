"""Find StretchBlt / GTile draw / cell-render loops."""
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
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)

print("=== GDI imports ===")
iat = {}
for e in pe.DIRECTORY_ENTRY_IMPORT:
    dll = e.dll.decode()
    for imp in e.imports:
        if not imp.name:
            continue
        name = imp.name.decode()
        if name in (
            "StretchBlt",
            "SetDIBitsToDevice",
            "CreateDIBSection",
            "BitBlt",
            "TransparentBlt",
            "AlphaBlend",
            "DirectDrawCreate",
        ) or "Blt" in name:
            print(f"  {dll} {name} iat={hex(imp.address)}")
            iat[name] = imp.address


def xrefs_to_imm(va):
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


print("\n=== IAT xrefs (call [iat] = FF 15) ===")
for name, addr in iat.items():
    xr = xrefs_to_imm(addr)
    print(f"  {name} n={len(xr)}")
    for va in xr[:15]:
        # show bytes around
        o = va - text_va + text_off
        print(f"    {hex(va)}  {data[o-3:o+5].hex()}")

print("\n=== GTile / Draw / Paint strings ===")
import re

for m in re.finditer(rb"GTile[\x20-\x7e]{0,40}", data):
    s = m.group().decode("ascii", "replace")
    if len(s) < 5:
        continue
    print(" ", s[:80])

# more paint-ish
for pat in [
    b"PaintTile",
    b"DrawTile",
    b"DrawMap",
    b"PaintMap",
    b"subimg",
    b"tilew",
    b"TileW",
    b"m_nTile",
    b"Diamond",
    b"isometric",
]:
    i = data.find(pat)
    print(f"  find {pat} -> {i}")
