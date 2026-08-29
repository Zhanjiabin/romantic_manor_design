"""Dump per-cell blit 0x4c2640 / 0x4c2590 / 0x4c2230."""
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
OUT = Path(__file__).with_name("paint_blit.txt")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()

cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)


def va_to_off(va):
    return pe.get_offset_from_rva(va - IB)


def cstring(va, n=80):
    try:
        o = va_to_off(va)
    except Exception:
        return None
    s = data[o : o + n].split(b"\x00", 1)[0]
    if s and all(32 <= b < 127 for b in s):
        return s.decode("ascii")
    return None


def dump_fn(start_va, maxn=0x2000):
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
        lines.append(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}{extra}")
        if ins.mnemonic in ("ret", "retn") and ins.address > start_va + 4:
            break
    return lines


parts = []
for va, name in [
    (0x4C2230, "world_to_tile_4c2230"),
    (0x4C2590, "paint_edge_4c2590"),
    (0x4C2640, "paint_cell_4c2640"),
    (0x4C2A80, "paint_alt_4c2a80"),
    (0x4C29E0, "paint_rect_4c29e0"),
]:
    parts.append("\n" + "=" * 70)
    parts.append(f"{name} @ {hex(va)}")
    parts.append("=" * 70)
    ln = dump_fn(va)
    parts.extend(ln)
    print(name, "nins", len(ln), "last", ln[-1] if ln else None)

OUT.write_text("\n".join(parts), encoding="utf-8")
print("wrote", OUT)
