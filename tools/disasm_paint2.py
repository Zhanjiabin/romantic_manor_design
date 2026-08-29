"""Disassemble GBkTile::PaintTileEx and nearby tile blit helpers."""
from pathlib import Path

import capstone
import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()

text = [s for s in pe.sections if s.Name.startswith(b".text")][0]
text_off = text.PointerToRawData
text_end = text_off + text.SizeOfRawData
text_va = IB + text.VirtualAddress
text_size = text.Misc_VirtualSize
code = data[text_off : text_off + text.SizeOfRawData]

cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
cs.detail = True


def va_to_off(va):
    rva = va - IB
    return pe.get_offset_from_rva(rva)


def read_va(va, n):
    off = va_to_off(va)
    return data[off : off + n]


def find_func_start(va, max_back=0x800):
    """Walk back for typical MSVC prologue."""
    off = va_to_off(va)
    best = va
    for back in range(0, max_back):
        o = off - back
        if o < text_off:
            break
        b = data[o : o + 16]
        # push ebp; mov ebp, esp
        if b[0] == 0x55 and b[1] == 0x8B and b[2] == 0xEC:
            # optional hotpatch mov edi,edi = 8B FF before
            start_off = o
            if o >= 2 and data[o - 2] == 0x8B and data[o - 1] == 0xFF:
                start_off = o - 2
            return IB + text.VirtualAddress + (start_off - text_off)
        # CC CC padding then prologue
        if back > 4 and data[o] == 0xCC and data[o + 1] == 0x55:
            return IB + text.VirtualAddress + (o + 1 - text_off)
    return best


def disasm_range(start_va, size, title):
    print(f"\n===== {title} @ {hex(start_va)} size={hex(size)} =====")
    blob = read_va(start_va, size)
    for ins in cs.disasm(blob, start_va):
        extra = ""
        if ins.mnemonic == "call":
            extra = "  ; CALL"
        elif ins.mnemonic == "push" and ins.op_str.startswith("0x5"):
            extra = "  ; imm"
        print(f"  {hex(ins.address)}: {ins.mnemonic:8s} {ins.op_str}{extra}")
        if ins.mnemonic == "ret" or ins.mnemonic == "retn":
            if ins.address > start_va + 8:
                break


# PaintTileEx string push at 0x4c403b
xref = 0x4C403B
fn = find_func_start(xref)
print("PaintTileEx func start guess:", hex(fn), "xref", hex(xref), "delta", hex(xref - fn))

# dump from guessed start for 0x600 bytes, stop at ret after we've passed xref
disasm_range(fn, min(0x800, xref - fn + 0x120), "GBkTile::PaintTileEx (guess)")

# GTile::subimg xrefs
import struct

subimg_va = 0x5DBA6C
pat = struct.pack("<I", subimg_va)
p = 0
print("\n===== GTile::subimg xrefs =====")
while True:
    i = code.find(pat, p)
    if i < 0:
        break
    va = text_va + i
    print(" xref imm at", hex(va), "bytes", data[text_off + i - 6 : text_off + i + 4].hex())
    p = i + 1
