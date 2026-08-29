"""Extract GTile.cpp / GSysMapView nearby strings; find render."""
import re
from pathlib import Path

import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()


def off_to_va(off):
    for s in pe.sections:
        raw, rsz = s.PointerToRawData, s.SizeOfRawData
        if raw <= off < raw + rsz:
            return IB + s.VirtualAddress + (off - raw)
    return None


# dump 2KB of strings around GTile.cpp
i = data.find(b"GTile.cpp")
print("GTile.cpp off", hex(i), "va", hex(off_to_va(i)))
region = data[i - 0x400 : i + 0x800]
for m in re.finditer(rb"[\x20-\x7e]{6,120}", region):
    print(" ", m.group().decode("ascii", "replace"))

print("\n===== GSysMapView strings =====")
for m in re.finditer(rb"GSysMapView[\x20-\x7e]{0,80}", data):
    print(" ", hex(off_to_va(m.start())), m.group().decode())

print("\n===== GBkTile method name table (around PaintTileEx names) =====")
j = data.find(b"PaintTileEx(x,y,size,pname,mode)")
region = data[j - 0x200 : j + 0x400]
for m in re.finditer(rb"[\x20-\x7e]{6,80}", region):
    print(" ", m.group().decode("ascii", "replace"))

print("\n===== nDrawTileSize neighborhood =====")
k = data.find(b"nDrawTileSize")
region = data[k - 0x100 : k + 0x280]
for m in re.finditer(rb"[\x20-\x7e]{6,100}", region):
    print(" ", m.group().decode("ascii", "replace"))
