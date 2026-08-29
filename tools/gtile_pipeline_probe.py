r"""Read-only static probe for the rc3.exe GTile rendering pipeline.

The script only reads the PE image and prints deterministic text to stdout.
It never launches rc3.exe and never writes or modifies game resources.

Usage:
    python gtile_pipeline_probe.py
    python gtile_pipeline_probe.py --exe D:\path\to\rc3.exe
"""

from __future__ import annotations

import argparse
import hashlib
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import capstone
from capstone import x86_const
import pefile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from game_paths import LAUNCHER

DEFAULT_EXE = LAUNCHER


@dataclass(frozen=True)
class ProbeRegion:
    name: str
    start: int
    end: int
    stop_at_ret: bool = True


REGIONS = (
    ProbeRegion("terrain_import_521050", 0x521050, 0x521390),
    ProbeRegion("candidate_4c5f80", 0x4C5F80, 0x4C6200),
    ProbeRegion("region_4c3660_4c3800", 0x4C3660, 0x4C3800, False),
    ProbeRegion("function_460f30", 0x460F30, 0x461000, False),
    ProbeRegion("function_461300", 0x461300, 0x461500),
    # 0x48DD40 is the second byte of the instruction at 0x48DD3F.
    # Decode from the actual 16-byte-aligned function start.
    ProbeRegion("function_containing_48dd40", 0x48DD20, 0x48DD90),
)

REQUESTED_ANCHORS = (0x4C5F80, 0x4C3660, 0x460F30, 0x461300, 0x48DD40)


class PEProbe:
    def __init__(self, exe: Path) -> None:
        self.exe = exe
        self.data = exe.read_bytes()
        self.pe = pefile.PE(data=self.data, fast_load=False)
        self.image_base = self.pe.OPTIONAL_HEADER.ImageBase
        self.cs = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_32)
        self.cs.detail = True
        self.imports = self._load_imports()
        self.text = next(
            section
            for section in self.pe.sections
            if section.Name.rstrip(b"\0") == b".text"
        )

    def _load_imports(self) -> dict[int, str]:
        imports: dict[int, str] = {}
        for desc in getattr(self.pe, "DIRECTORY_ENTRY_IMPORT", []):
            dll = desc.dll.decode("ascii", "replace")
            for item in desc.imports:
                symbol = (
                    item.name.decode("ascii", "replace")
                    if item.name
                    else f"ordinal_{item.ordinal}"
                )
                imports[item.address] = f"{dll}!{symbol}"
        return imports

    def va_to_offset(self, va: int) -> int:
        return self.pe.get_offset_from_rva(va - self.image_base)

    def bytes_at(self, start: int, end: int) -> bytes:
        offset = self.va_to_offset(start)
        return self.data[offset : offset + (end - start)]

    def disasm(self, start: int, end: int) -> list[capstone.CsInsn]:
        return list(self.cs.disasm(self.bytes_at(start, end), start))

    def text_instructions(self) -> Iterable[capstone.CsInsn]:
        start = self.image_base + self.text.VirtualAddress
        offset = self.text.PointerToRawData
        blob = self.data[offset : offset + self.text.SizeOfRawData]
        return self.cs.disasm(blob, start)

    @staticmethod
    def direct_branch_target(ins: capstone.CsInsn) -> int | None:
        if not ins.operands:
            return None
        operand = ins.operands[0]
        if operand.type == x86_const.X86_OP_IMM:
            return operand.imm & 0xFFFFFFFF
        return None

    def indirect_import(self, ins: capstone.CsInsn) -> str | None:
        if not ins.operands:
            return None
        operand = ins.operands[0]
        if operand.type != x86_const.X86_OP_MEM:
            return None
        mem = operand.mem
        if mem.base == 0 and mem.index == 0:
            return self.imports.get(mem.disp & 0xFFFFFFFF)
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Read-only rc3.exe GTile pipeline disassembly probe"
    )
    parser.add_argument(
        "--exe",
        type=Path,
        default=DEFAULT_EXE,
        help=f"PE image to read (default: {DEFAULT_EXE})",
    )
    return parser.parse_args()


def region_contains(region: ProbeRegion, address: int) -> bool:
    return region.start <= address < region.end


def format_ins(probe: PEProbe, ins: capstone.CsInsn) -> str:
    note = ""
    if ins.mnemonic in ("call", "jmp"):
        target = probe.direct_branch_target(ins)
        imported = probe.indirect_import(ins)
        if target is not None:
            note = f"  ; direct -> 0x{target:08X}"
        elif imported:
            note = f"  ; import -> {imported}"
    return f"0x{ins.address:08X}: {ins.mnemonic:<8} {ins.op_str}{note}"


def instructions_for_region(
    probe: PEProbe, region: ProbeRegion
) -> list[capstone.CsInsn]:
    instructions = probe.disasm(region.start, region.end)
    if not region.stop_at_ret:
        return instructions
    selected: list[capstone.CsInsn] = []
    for ins in instructions:
        selected.append(ins)
        if ins.mnemonic.startswith("ret") and ins.address > region.start + 4:
            break
    return selected


def main() -> int:
    args = parse_args()
    exe = args.exe.resolve()
    if not exe.is_file():
        raise SystemExit(f"PE image not found: {exe}")

    probe = PEProbe(exe)
    digest = hashlib.sha256(probe.data).hexdigest()
    print("GTILE PIPELINE STATIC PROBE")
    print(f"exe: {exe}")
    print(f"sha256: {digest}")
    print(f"image_base: 0x{probe.image_base:08X}")
    print("mode: read-only; stdout only; executable is never launched")
    print()
    print("=== MARKER TEXTURE SOURCE-COORDINATE TEST (256x129) ===")
    width, height = 256, 129
    columns = (width + 63) // 64
    marker_tiles: list[tuple[int, int, int]] = []
    index = 0
    while True:
        row, column = divmod(index, columns)
        source_x = column * 64 + (32 if row & 1 else 0)
        source_y = row * 16
        if source_y + 33 > height:
            break
        if source_x + 65 <= width:
            marker_tiles.append((index, source_x, source_y))
        index += 1
    print(f"columns={columns} valid_tiles={len(marker_tiles)}")
    for index, source_x, source_y in marker_tiles:
        print(f"  marker[{index:02d}] -> source=({source_x:3d},{source_y:3d})")
    if len(marker_tiles) != 21:
        raise SystemExit("marker self-test failed: expected 21 c01 variants")

    decoded: dict[str, list[capstone.CsInsn]] = {}
    for region in REGIONS:
        instructions = instructions_for_region(probe, region)
        decoded[region.name] = instructions
        print()
        print(
            f"=== {region.name}: "
            f"0x{region.start:08X}-0x{region.end:08X} ==="
        )
        for ins in instructions:
            print(format_ins(probe, ins))

    print()
    print("=== REQUESTED ANCHOR STATUS ===")
    all_decoded = [ins for instructions in decoded.values() for ins in instructions]
    for anchor in REQUESTED_ANCHORS:
        exact = next((ins for ins in all_decoded if ins.address == anchor), None)
        containing = next(
            (
                ins
                for ins in all_decoded
                if ins.address < anchor < ins.address + ins.size
            ),
            None,
        )
        if exact:
            print(f"0x{anchor:08X}: instruction boundary")
        elif containing:
            print(
                f"0x{anchor:08X}: inside instruction at "
                f"0x{containing.address:08X} "
                f"({containing.mnemonic} {containing.op_str})"
            )
        else:
            print(f"0x{anchor:08X}: not covered by decoded regions")

    direct_calls: list[tuple[int, int]] = []
    for ins in probe.text_instructions():
        if ins.mnemonic != "call":
            continue
        target = probe.direct_branch_target(ins)
        if target is not None:
            direct_calls.append((ins.address, target))

    print()
    print("=== DIRECT CALL RELATIONSHIPS ===")
    for region in REGIONS:
        callers = [
            (site, target)
            for site, target in direct_calls
            if region_contains(region, target)
        ]
        print(
            f"{region.name} "
            f"[0x{region.start:08X},0x{region.end:08X}):"
        )
        if callers:
            for site, target in callers:
                print(f"  caller 0x{site:08X} -> 0x{target:08X}")
        else:
            print("  no direct relative call found in .text")

        callees: list[tuple[int, int]] = []
        seen: set[tuple[int, int]] = set()
        for ins in decoded[region.name]:
            if ins.mnemonic != "call":
                continue
            target = probe.direct_branch_target(ins)
            pair = (ins.address, target) if target is not None else None
            if pair is not None and pair not in seen:
                seen.add(pair)
                callees.append(pair)
        if callees:
            for site, target in callees:
                print(f"  callee 0x{site:08X} -> 0x{target:08X}")
        else:
            print("  no direct callee in dumped instructions")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
