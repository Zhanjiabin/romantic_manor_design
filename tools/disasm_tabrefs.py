"""Show all instructions that reference diamond tables."""
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
        if "0x6635" in ins.op_str:
            print(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}")


for va, sz in [
    (0x520850, 0x80),
    (0x520A00, 0x400),
    (0x521390, 0x200),
]:
    dump(va, sz)

print("\n===== 0x520b00 region linear =====")
blob = data[va_to_off(0x520B00) : va_to_off(0x520B00) + 0x180]
for ins in cs.disasm(blob, 0x520B00):
    print(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}")
