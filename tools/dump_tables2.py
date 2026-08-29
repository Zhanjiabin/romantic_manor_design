"""Find who fills diamond tables; dump 0x520a00 screen blit."""
import struct
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()
text = [s for s in pe.sections if s.Name.startswith(b".text")][0]
text_va = IB + text.VirtualAddress
code = data[text.PointerToRawData : text.PointerToRawData + text.SizeOfRawData]
cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)


def va_to_off(va):
    return pe.get_offset_from_rva(va - IB)


# search whole file for table addresses
raw = data
for va in (0x663588, 0x6635CC, 0x663610, 0x663580):
    pat = struct.pack("<I", va)
    idx = 0
    hits = []
    while True:
        i = raw.find(pat, idx)
        if i < 0:
            break
        hits.append(i)
        idx = i + 1
    print(hex(va), "file hits", len(hits), [hex(h) for h in hits[:12]])

print("\n===== screen blit 0x520a00 =====")
blob = data[va_to_off(0x520A00) : va_to_off(0x520A00) + 0x280]
n = 0
for ins in cs.disasm(blob, 0x520A00):
    print(f"{hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}")
    n += 1
    if ins.mnemonic in ("ret", "retn") and n > 8:
        break
    if n > 90:
        break

# reconstruct diamond and print
print("\n===== reconstructed diamond 65x33 =====")
acc = 0
starts, widths, srcx = [], [], []
for y in range(33):
    t = y if y <= 16 else 32 - y
    w = 1 + 4 * t
    x0 = 32 - 2 * t
    starts.append(acc)
    widths.append(w)
    srcx.append(x0)
    acc += w
print("packed", acc, "hex", hex(acc))
print("starts", starts)
print("widths", widths)
print("srcx", srcx)
