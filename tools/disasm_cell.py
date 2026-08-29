"""Continue blit wrappers past early-out rets; dump 0x4c2530."""
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
OUT = Path(__file__).with_name("paint_cell.txt")
pe = pefile.PE(str(EXE))
data = EXE.read_bytes()
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)


def va_to_off(va):
    return pe.get_offset_from_rva(va - pe.OPTIONAL_HEADER.ImageBase)


def dump(start_va, size):
    blob = data[va_to_off(start_va) : va_to_off(start_va) + size]
    lines = []
    for ins in cs.disasm(blob, start_va):
        lines.append(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}")
    return lines


parts = []
for va, size, name in [
    (0x4C2530, 0x80, "cell_lookup_4c2530"),
    (0x4C2590, 0x120, "paint_edge_full"),
    (0x4C2640, 0x200, "paint_cell_full"),
]:
    parts.append("\n" + "=" * 70)
    parts.append(f"{name} @ {hex(va)}")
    parts.append("=" * 70)
    parts.extend(dump(va, size))

OUT.write_text("\n".join(parts), encoding="utf-8")
print("wrote", len(parts))
