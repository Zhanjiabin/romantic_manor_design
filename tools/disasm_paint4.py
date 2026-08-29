"""Full dump of GBkTile paint core 0x4c2c40 and helpers."""
import struct
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
OUT = Path(__file__).with_name("paint_disasm.txt")
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
    return data[va_to_off(va) : va_to_off(va) + n]


def cstring(va, n=80):
    try:
        o = va_to_off(va)
    except Exception:
        return None
    s = data[o : o + n].split(b"\x00", 1)[0]
    if s and all(32 <= b < 127 for b in s):
        return s.decode("ascii")
    return None


def callers(dst):
    out = []
    for i in range(0, len(code) - 5):
        if code[i] != 0xE8:
            continue
        rel = struct.unpack_from("<i", code, i + 1)[0]
        src = text_va + i
        if src + 5 + rel == dst:
            out.append(src)
    return out


def dump_fn(start_va, maxn=0x1200):
    blob = read_va(start_va, maxn)
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

# callers of PaintTileEx
pt = 0x4C3FF0
parts.append(f"PaintTileEx @ {hex(pt)} callers: {[hex(c) for c in callers(pt)]}")
core = 0x4C2C40
parts.append(f"paint-core 0x4c2c40 callers: {[hex(c) for c in callers(core)]}")
look = 0x520FC0
parts.append(f"lookup 0x520fc0 callers n={len(callers(look))}")

for va, name in [
    (0x4C3FF0, "GBkTile::PaintTileEx"),
    (0x4C3ED0, "maybe_PaintTile_wrapper"),
    (0x4C2C40, "GBkTile_paint_core"),
    (0x4C61A0, "GBkTile_prepaint_4c61a0"),
    (0x520FC0, "tile_name_lookup_520fc0"),
    (0x4C37D0, "GBkTile_4c37d0"),
]:
    parts.append("\n" + "=" * 70)
    parts.append(f"{name} @ {hex(va)}")
    parts.append("=" * 70)
    parts.extend(dump_fn(va))

OUT.write_text("\n".join(parts), encoding="utf-8")
print("wrote", OUT, "lines", len(parts))
print("PaintTileEx callers", [hex(c) for c in callers(pt)])
print("core callers", [hex(c) for c in callers(core)])
print("core nins", len(dump_fn(core)))
print("4c61a0 nins", len(dump_fn(0x4C61A0)))
print("520fc0 nins", len(dump_fn(0x520FC0)))
