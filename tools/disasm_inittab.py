"""Disassemble diamond table initializer near 0x663580 refs."""
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
data = EXE.read_bytes()
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)


def va_to_off(va):
    return pe.get_offset_from_rva(va - pe.OPTIONAL_HEADER.ImageBase)


def dump(start, size):
    blob = data[va_to_off(start) : va_to_off(start) + size]
    for ins in cs.disasm(blob, start):
        print(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}")


# file 0xc5fa7 -> VA 0x400000+0xc5fa7 = 0x4c5fa7 if raw=va for .text
print("===== 0x4c5f80 =====")
dump(0x4C5F80, 0xC0)
print("\n===== 0x520000 table init? =====")
dump(0x520000, 0x120)
print("\n===== 0x51fff0 =====")
dump(0x51FFC0, 0x80)
