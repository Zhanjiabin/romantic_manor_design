"""Recover PaintTileEx function bounds and callees."""
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
cs.detail = True


def va_to_off(va):
    return pe.get_offset_from_rva(va - IB)


def read_va(va, n):
    o = va_to_off(va)
    return data[o : o + n]


def disasm(start_va, size, stop_rets=3):
    blob = read_va(start_va, size)
    nret = 0
    lines = []
    for ins in cs.disasm(blob, start_va):
        lines.append(ins)
        if ins.mnemonic in ("ret", "retn"):
            nret += 1
            if nret >= stop_rets:
                break
    return lines


def fmt(ins):
    cmt = ""
    if ins.mnemonic == "push":
        try:
            v = int(ins.op_str, 16) if ins.op_str.startswith("0x") else None
        except Exception:
            v = None
        if v and 0x400000 < v < 0x700000:
            o = va_to_off(v)
            s = data[o : o + 80].split(b"\x00", 1)[0]
            if s and all(32 <= b < 127 or b in (9, 10) for b in s):
                cmt = f'  ; "{s.decode("ascii","replace")[:60]}"'
    return f"  {hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}{cmt}"


# scan 0x4c3b00..0x4c4200 for prologues 55 8B EC
print("=== prologues 0x4c3b00-0x4c4300 ===")
start = 0x4C3B00
blob = read_va(start, 0x900)
for i, b in enumerate(blob[:-3]):
    if b == 0x55 and blob[i + 1] == 0x8B and blob[i + 2] == 0xEC:
        print("  prologue", hex(start + i))
    if b == 0xCC and blob[i + 1] == 0x55 and blob[i + 2] == 0x8B:
        print("  int3+prologue", hex(start + i + 1))

# find CALL rel32 targeting range
print("\n=== calls into 0x4c2c00-0x4c4500 ===")
targets = {}
# walk .text for E8 rel32
for i in range(0, len(code) - 5):
    if code[i] != 0xE8:
        continue
    rel = struct.unpack_from("<i", code, i + 1)[0]
    src = text_va + i
    dst = src + 5 + rel
    if 0x4C2C00 <= dst <= 0x4C4500:
        targets.setdefault(dst, []).append(src)

for dst, srcs in sorted(targets.items()):
    print(f"  dest {hex(dst)}  n={len(srcs)}  e.g. {', '.join(hex(s) for s in srcs[:8])}")

print("\n===== linear from 0x4c3f80 =====")
for ins in disasm(0x4C3F80, 0x280, stop_rets=2):
    print(fmt(ins))
