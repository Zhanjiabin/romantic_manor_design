# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import io
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from export_xlsx import build_materials_xlsx, safe_filename

PNG_1X1 = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
)


def test_safe_filename_strips_unsafe_and_adds_xlsx():
    assert safe_filename("咖啡馆/材料") == "咖啡馆材料.xlsx"
    assert safe_filename("list.xlsx") == "list.xlsx"


def test_materials_xlsx_embeds_icons_and_sheet_name():
    data, filename = build_materials_xlsx(
        {
            "title": "咖啡馆 材料清单",
            "filename": "咖啡馆-材料清单",
            "groups": [
                {
                    "id": "total",
                    "name": "合计",
                    "rows": [
                        {"name": "木头", "count": 12, "source": "整栋", "icon": PNG_1X1},
                        {"name": "石材", "count": 4, "source": "整栋"},
                    ],
                },
                {
                    "name": "户型",
                    "rows": [{"name": "木头", "count": 2, "source": "户型", "icon": PNG_1X1}],
                },
            ],
        }
    )
    assert filename == "咖啡馆-材料清单.xlsx"
    assert data[:2] == b"PK"
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        names = set(zf.namelist())
        assert "xl/worksheets/sheet1.xml" in names
        assert "xl/media/image1.png" in names
        assert "xl/drawings/drawing1.xml" in names
        sheet = zf.read("xl/worksheets/sheet1.xml").decode("utf-8")
        assert "木头" in sheet
        assert "石材" in sheet
        assert "16 种" not in sheet
        assert "2 种 · 共 16 件" in sheet
        workbook = zf.read("xl/workbook.xml").decode("utf-8")
        assert 'name="材料清单"' in workbook
        assert zf.read("xl/media/image1.png").startswith(b"\x89PNG")
