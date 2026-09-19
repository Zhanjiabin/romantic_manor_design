"""Check the real ZIP downloaded by verify-board-mosaic.cjs, including native ALEs."""
from pathlib import Path
import json
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from codec.board_ani import decode_board_ani, decode_board_clip


def verify(path):
    with zipfile.ZipFile(path) as archive:
        assert archive.testzip() is None, "ZIP checksum mismatch"
        project = json.loads(archive.read("拼接图纸.json"))
        layout = project["layout"]
        width = layout["cols"] * 36
        indices = [i for i, on in enumerate(layout["mask"]) if on]
        assert len([n for n in archive.namelist() if n.endswith(".ale")]) == len(indices)
        reconstructed = [[50] * len(page) for page in project["pages"]]
        for number, index in enumerate(indices, 1):
            col, row = index % layout["cols"], index // layout["cols"]
            name = f"{number:02d}_行{row + 1}_列{col + 1}"
            expected = [[page[(row * 24 + y) * width + col * 36 + x]
                         for y in range(24) for x in range(36)] for page in project["pages"]]
            clip = decode_board_clip(archive.read(name + "_全部粘贴.txt").decode("utf-8"))
            native = decode_board_ani(archive.read(name + ".ale"))["pages"]
            assert clip == expected, f"{name}: clipboard cells differ"
            assert native == expected, f"{name}: ALE cells differ"
            for page, tile in zip(reconstructed, native):
                for y in range(24):
                    start = (row * 24 + y) * width + col * 36
                    page[start:start + 36] = tile[y * 36:(y + 1) * 36]
        assert reconstructed == project["pages"], "Reassembled artwork differs"
        print(f"{len(indices)} ALEs and clipboard files reassemble every frame exactly; ZIP CRC passed")


if __name__ == "__main__":
    verify(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "_tmp_board_mosaic/mosaic.zip")
