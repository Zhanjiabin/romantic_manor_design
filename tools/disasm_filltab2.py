from pathlib import Path
import capstone, pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
data = EXE.read_bytes()
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)

def va_to_off(va):
    return pe.get_offset_from_rva(va - pe.OPTIONAL_HEADER.ImageBase)

start = 0x520DB0
blob = data[va_to_off(start):va_to_off(start)+0x120]
for ins in cs.disasm(blob, start):
    print(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}")
    if ins.mnemonic in ("ret","retn") and ins.address > start + 4:
        break
