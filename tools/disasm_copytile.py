"""Find MakeTile function start and dump 0x520850 copy-tile."""
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


print("===== 0x520850 copy tile =====")
dump(0x520850, 0x200)

print("\n===== 0x5210e0 import loop start =====")
dump(0x5210E0, 0x130)

print("\n===== 0x521f50 =====")
dump(0x521F50, 0x80)
