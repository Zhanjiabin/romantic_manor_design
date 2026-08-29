"""Dump GBkTile::CreateWaterLayer and GWaterLayer::UpdateWaterMask."""
from __future__ import annotations

import struct
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
OUT = Path(__file__).with_name("gwater_disasm.txt")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()
text = [s for s in pe.sections if s.Name.startswith(b".text")][0]
text_off = text.PointerToRawData
text_va = IB + text.VirtualAddress
code = data[text_off : text_off + text.SizeOfRawData]
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)


def va_to_off(va):
    return pe.get_offset_from_rva(va - IB)


def cstring(va, n=90):
    try:
        o = va_to_off(va)
    except Exception:
        return None
    s = data[o : o + n].split(b"\x00", 1)[0]
    if s and all(32 <= b < 127 for b in s):
        return s.decode("ascii")
    return None


def imm_xrefs(target):
    pat = struct.pack("<I", target)
    out = []
    p = 0
    while True:
        i = code.find(pat, p)
        if i < 0:
            break
        out.append(text_va + i)
        p = i + 1
    return out


def call_xrefs(dst):
    out = []
    for i in range(0, len(code) - 5):
        if code[i] != 0xE8:
            continue
        rel = struct.unpack_from("<i", code, i + 1)[0]
        src = text_va + i
        if src + 5 + rel == dst:
            out.append(src)
    return out


def dump_fn(start_va, maxn=0xA00):
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


def guess_fn_start(xref):
    # walk back for typical prologue sub esp / push ebp / mov eax, fs:[0]
    off = va_to_off(xref)
    for delta in range(0, 0x120):
        va = xref - delta
        b = data[va_to_off(va) : va_to_off(va) + 6]
        if b[:2] == b"\x55\x8b" or b[:3] == b"\x6a\xff\x68" or b[0] == 0x55:
            # look for exception prologue
            if data[va_to_off(va)] == 0x6A or data[va_to_off(va)] == 0x55 or data[va_to_off(va)] == 0x83:
                return va
        if b[:2] == b"\x83\xec" or b[:3] == b"\x81\xec":
            return va
    return xref


parts = []
targets = {
    "CreateWaterLayer(pwaterkindname,pmaskname,pimg1,pimg2)": 0x5CD6A0,
    "CreateWaterLayer": 0x5CD6D8,
    "UpdateWaterMask": 0x5CD878,
    "UpdateWaterMask(pLink)": 0x5D0C8C,
    "SetWaterImg": 0x5CDA04,
    "SetWaterImg(p1,p2)?": 0x5D0CA4,
    "Can't get waterlayer tile14": 0x5CDA1C,
    "GWaterLayer.cpp": 0x5D0C38,
}

for name, va in targets.items():
    xr = imm_xrefs(va)
    parts.append(f"\n=== {name} @{hex(va)} imm xrefs {[hex(x) for x in xr[:20]]} n={len(xr)} ===")

# dump around CreateWaterLayer xrefs
create_str = 0x5CD6A0
for xr in imm_xrefs(create_str)[:8]:
    start = xr - 0x80
    parts.append(f"\n----- context {hex(xr)} (CreateWaterLayer string push) -----")
    parts.extend(dump_fn(start, 0x200)[:80])

# GWaterLayer.cpp path is often near RTTI; dump functions that push UpdateWaterMask(pLink)
for xr in imm_xrefs(0x5D0C8C)[:10]:
    parts.append(f"\n----- UpdateWaterMask(pLink) push @{hex(xr)} -----")
    parts.extend(dump_fn(xr - 0x40, 0x180)[:60])

# tile14 error
for xr in imm_xrefs(0x5CDA1C)[:6]:
    parts.append(f"\n----- tile14 err @{hex(xr)} -----")
    parts.extend(dump_fn(xr - 0x60, 0x120)[:50])

OUT.write_text("\n".join(parts), encoding="utf-8")
print("wrote", OUT)
for name, va in targets.items():
    print(name, [hex(x) for x in imm_xrefs(va)[:8]])
