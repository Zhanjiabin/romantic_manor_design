"""Disassemble GTile Make-Import / GetTile14; flag 64/32/256 constants."""
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
OUT = Path(__file__).with_name("gtile_import.txt")
pe = pefile.PE(str(EXE))
data = EXE.read_bytes()
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
cs.detail = True


def va_to_off(va):
    return pe.get_offset_from_rva(va - pe.OPTIONAL_HEADER.ImageBase)


def dump(start, size):
    blob = data[va_to_off(start) : va_to_off(start) + size]
    lines = []
    for ins in cs.disasm(blob, start):
        note = ""
        # flag interesting immediates
        if any(
            x in ins.op_str
            for x in (
                "0x40",
                "0x20",
                "0x80",
                "0x100",
                "0xff",
                "0x41",
                "0x81",
            )
        ):
            note = "  ; **const**"
        lines.append(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}{note}")
    return lines


parts = []
for va, size, name in [
    (0x521200, 0xB00, "MakeTileImport_region"),
    (0x51FAE0, 0x200, "GBrushImg_err"),
    (0x4C3080, 0x80, "sd_1_d_64"),
    (0x5220C0, 0x80, "mask_jpg"),
]:
    parts.append("\n" + "=" * 70)
    parts.append(f"{name} @ {hex(va)}")
    parts.append("=" * 70)
    parts.extend(dump(va, size))

OUT.write_text("\n".join(parts), encoding="utf-8")
print("wrote", OUT, "bytes", OUT.stat().st_size)
