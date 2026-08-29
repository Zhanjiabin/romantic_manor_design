"""Extract diamond scanline tables and find who fills them."""
import struct
from pathlib import Path

import pefile

EXE = Path(r"d:\game\浪漫庄园\launcher\rc3.exe")
pe = pefile.PE(str(EXE))
IB = pe.OPTIONAL_HEADER.ImageBase
data = EXE.read_bytes()
text = [s for s in pe.sections if s.Name.startswith(b".text")][0]
text_off = text.PointerToRawData
text_va = IB + text.VirtualAddress
code = data[text_off : text_off + text.SizeOfRawData]


def va_to_off(va):
    rva = va - IB
    try:
        return pe.get_offset_from_rva(rva)
    except Exception:
        return None


def dump_words(va, n):
    o = va_to_off(va)
    print(f"\n=== {hex(va)} file_off={o} ===")
    if o is None or o < 0 or o + n * 2 > len(data):
        print("  unmapped")
        return
    words = struct.unpack_from("<" + "H" * n, data, o)
    print(" ", list(words))
    print("  nonzero", sum(1 for w in words if w))


for va in (0x663588, 0x6635CC, 0x663610, 0x5DB984, 0x5DB9D0):
    dump_words(va, 40)

print("\n=== code xrefs to table VAs ===")
for va in (0x663588, 0x6635CC, 0x663610):
    pat = struct.pack("<I", va)
    p = 0
    xs = []
    while True:
        i = code.find(pat, p)
        if i < 0:
            break
        xs.append(hex(text_va + i))
        p = i + 1
    print(hex(va), xs)

# also search lea / mov of these
print("\n=== 0x5db984 xrefs ===")
for va in (0x5DB984, 0x5DB9D0):
    pat = struct.pack("<I", va)
    p = 0
    xs = []
    while True:
        i = code.find(pat, p)
        if i < 0:
            break
        xs.append(hex(text_va + i))
        p = i + 1
    print(hex(va), xs[:20], "n", len(xs))
