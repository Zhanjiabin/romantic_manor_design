"""Dump DrawTile / GTile.cpp strings and StretchBlt wrapper."""
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
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)


def off_to_va(off):
    for s in pe.sections:
        raw = s.PointerToRawData
        rsz = s.SizeOfRawData
        if raw <= off < raw + rsz:
            return IB + s.VirtualAddress + (off - raw)
    return None


def va_to_off(va):
    return pe.get_offset_from_rva(va - IB)


print("=== strings containing Tile / Draw / Paint / GTile ===")
for m in re.finditer(rb"[\x20-\x7e]{0,40}(DrawTile|PaintTile|GTile\.cpp|GBkTile\.cpp|GTile::)[\x20-\x7e]{0,80}", data):
    va = off_to_va(m.start())
    print(f"  {hex(va) if va else None}  {m.group().decode('ascii','replace')[:100]}")


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


print("\n=== xrefs DrawTile-like ===")
for m in re.finditer(rb"[\x20-\x7e]*(DrawTile|PaintTile)[\x20-\x7e]*", data):
    va = off_to_va(m.start())
    if not va:
        continue
    xr = xrefs(va)
    print(m.group().decode()[:80], "VA", hex(va), "xrefs", [hex(x) for x in xr])


def dump(start, n=80):
    blob = data[va_to_off(start) : va_to_off(start) + 0x400]
    c = 0
    for ins in cs.disasm(blob, start):
        extra = ""
        if ins.op_str.startswith("0x5") or (ins.mnemonic == "push" and "0x" in ins.op_str):
            try:
                v = int(ins.op_str.split(",")[-1].strip(), 16)
                o = va_to_off(v)
                s = data[o : o + 60].split(b"\x00", 1)[0]
                if s and all(32 <= b < 127 for b in s):
                    extra = f'  ; "{s.decode()[:50]}"'
            except Exception:
                pass
        print(f"  {hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}{extra}")
        c += 1
        if ins.mnemonic in ("ret", "retn") and c > 5:
            break
        if c >= n:
            break


print("\n===== around StretchBlt 0x4529c0 =====")
dump(0x452980, 60)

print("\n===== GTile::subimg xref 0x5207e0 =====")
dump(0x5207C0, 40)
