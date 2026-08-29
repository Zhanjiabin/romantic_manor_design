"""Find native water / linkall draw path in rc3.exe."""
from __future__ import annotations

import re
import struct
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
OUT = Path(__file__).with_name("water_disasm.txt")
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
        raw, rsz = s.PointerToRawData, s.SizeOfRawData
        if raw <= off < raw + rsz:
            return IB + s.VirtualAddress + (off - raw)
    return None


def va_to_off(va):
    return pe.get_offset_from_rva(va - IB)


def cstring(va, n=100):
    try:
        o = va_to_off(va)
    except Exception:
        return None
    s = data[o : o + n].split(b"\x00", 1)[0]
    if s and all(32 <= b < 127 for b in s):
        return s.decode("ascii")
    return None


def dump_fn(start_va, maxn=0x800):
    blob = data[va_to_off(start_va) : va_to_off(start_va) + maxn]
    lines = []
    for ins in cs.disasm(blob, start_va):
        extra = ""
        if ins.mnemonic == "push" and ins.op_str.startswith("0x"):
            try:
                v = int(ins.op_str, 16)
                s = cstring(v)
                if s:
                    extra = f'  ; "{s}"'
            except Exception:
                pass
        elif ins.mnemonic == "call":
            extra = "  ; CALL"
        lines.append(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}{extra}")
        if ins.mnemonic in ("ret", "retn") and ins.address > start_va + 4:
            break
    return lines


parts = []

needles = [
    b"UpdateWaterMask",
    b"WaterMask",
    b"water/",
    b"Water",
    b"linkall",
    b"LinkAll",
    b"wlink",
    b"MakeSp",
    b"GBkTile",
]
parts.append("=== string hits ===")
for needle in needles:
    for m in re.finditer(re.escape(needle), data):
        va = off_to_va(m.start())
        window = data[max(0, m.start() - 40) : m.start() + 80]
        ascii_win = "".join(chr(b) if 32 <= b < 127 else "." for b in window)
        parts.append(f"  {needle!r} va={hex(va) if va else None}  {ascii_win}")

# GBK 水动画 / 水/
water_anim = "水动画".encode("gbk")
water_slash = "水/".encode("gbk")
for label, needle in [("水动画", water_anim), ("水/", water_slash)]:
    hits = list(re.finditer(re.escape(needle), data))
    parts.append(f"=== GBK {label} n={len(hits)} ===")
    for m in hits[:30]:
        va = off_to_va(m.start())
        window = data[max(0, m.start() - 20) : m.start() + 60]
        parts.append(f"  va={hex(va) if va else None} hex={window.hex()}")

# xrefs to UpdateWaterMask string
uw = data.find(b"UpdateWaterMask")
uw_va = off_to_va(uw)
parts.append(f"\nUpdateWaterMask string va={hex(uw_va)}")
pat = struct.pack("<I", uw_va)
xrefs = []
p = 0
while True:
    i = code.find(pat, p)
    if i < 0:
        break
    xrefs.append(text_va + i)
    p = i + 1
parts.append(f"imm xrefs: {[hex(x) for x in xrefs]}")

# dump functions around known paint and also search 'Water' C++ names
parts.append("\n=== C++ names with Water ===")
for m in re.finditer(rb"[\x20-\x7e]*Water[\x20-\x7e]{0,60}", data):
    s = m.group().decode("ascii", "replace")
    if "UpdateWaterMask" in s or "Water" in s:
        va = off_to_va(m.start())
        parts.append(f"  {hex(va) if va else None}  {s[:100]}")

OUT.write_text("\n".join(parts), encoding="utf-8")
print("wrote", OUT, "lines", len(parts))
