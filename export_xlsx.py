# -*- coding: utf-8 -*-
"""Build a styled .xlsx materials ledger with embedded PNG icons (stdlib zip)."""
from __future__ import annotations

import base64
import io
import re
import zipfile
from xml.sax.saxutils import escape

NS_PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
NS_OD = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
NS_SS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"

# 48 CSS pixels at 96dpi, in EMUs (1px = 9525 EMU).
ICON_EMU = 48 * 9525
ICON_PAD_EMU = 4 * 9525

_UNSAFE_FILE = re.compile(r'[\\/:*?"<>|]+')
_ILLEGAL_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def safe_filename(name: str, fallback: str = "材料清单") -> str:
    text = _UNSAFE_FILE.sub("", str(name or "").replace("\n", " ").strip()) or fallback
    text = text[:80].strip() or fallback
    if not text.lower().endswith(".xlsx"):
        text += ".xlsx"
    return text


def _xml_text(value) -> str:
    return escape(_ILLEGAL_XML.sub("", str(value if value is not None else "")))


def _col_row(col: int, row: int) -> str:
    return f"{chr(64 + col)}{row}"


def _decode_icon(raw) -> bytes | None:
    if not raw:
        return None
    if isinstance(raw, (bytes, bytearray)):
        data = bytes(raw)
    else:
        text = str(raw).strip()
        if not text:
            return None
        if text.startswith("data:") and "," in text:
            text = text.split(",", 1)[1]
        try:
            data = base64.b64decode(text)
        except Exception:
            return None
    if len(data) < 24:
        return None
    return _normalize_png(data)


def _normalize_png(data: bytes) -> bytes | None:
    try:
        from PIL import Image
    except ImportError:
        return data if data.startswith(b"\x89PNG") else None
    try:
        image = Image.open(io.BytesIO(data))
        image = image.convert("RGBA")
        image.thumbnail((48, 48), Image.Resampling.NEAREST)
        canvas = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
        canvas.paste(image, ((48 - image.width) // 2, (48 - image.height) // 2), image)
        out = io.BytesIO()
        canvas.save(out, format="PNG")
        return out.getvalue()
    except Exception:
        return data if data.startswith(b"\x89PNG") else None


def _inline_cell(ref: str, text: str, style: int) -> str:
    return (
        f'<c r="{ref}" t="inlineStr" s="{style}">'
        f"<is><t xml:space=\"preserve\">{_xml_text(text)}</t></is></c>"
    )


def _number_cell(ref: str, value: int, style: int) -> str:
    return f'<c r="{ref}" s="{style}"><v>{int(value)}</v></c>'


STYLES_XML = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="4">
    <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="16"/><color rgb="FF1E4A36"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
    <font><b/><sz val="12"/><color rgb="FF1E4A36"/><name val="Calibri"/><family val="2"/></font>
  </fonts>
  <fills count="4">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2F6B4F"/><bgColor indexed="64"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE8F3EC"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFB7C8B2"/></left>
      <right style="thin"><color rgb="FFB7C8B2"/></right>
      <top style="thin"><color rgb="FFB7C8B2"/></top>
      <bottom style="thin"><color rgb="FFB7C8B2"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment vertical="center"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">
      <alignment horizontal="right" vertical="center"/>
    </xf>
  </cellXfs>
</styleSheet>
"""


def build_materials_xlsx(payload: dict) -> tuple[bytes, str]:
    title = str((payload or {}).get("title") or "材料清单")
    filename = safe_filename((payload or {}).get("filename") or title)
    groups = list((payload or {}).get("groups") or [])
    summary_rows = []
    for group in groups:
        if group.get("id") == "total" or group.get("name") == "合计":
            summary_rows = list(group.get("rows") or [])
            break
    if not summary_rows:
        seen = {}
        for group in groups:
            if group.get("id") == "total" or group.get("name") == "合计":
                continue
            for row in group.get("rows") or []:
                name = str(row.get("name") or "")
                if not name:
                    continue
                seen[name] = seen.get(name, 0) + max(0, int(row.get("count") or 0))
        summary_rows = [{"name": name, "count": count} for name, count in seen.items()]
    kinds = len(summary_rows)
    pieces = sum(max(0, int(row.get("count") or 0)) for row in summary_rows)

    rows_xml = []
    merges = ['<mergeCell ref="A1:D1"/>', '<mergeCell ref="A2:D2"/>']
    images = []
    excel_row = 1

    rows_xml.append(
        f'<row r="{excel_row}" ht="28" customHeight="1">'
        f"{_inline_cell('A1', title, 1)}</row>"
    )
    excel_row = 2
    rows_xml.append(
        f'<row r="{excel_row}" ht="20" customHeight="1">'
        f"{_inline_cell('A2', f'{kinds} 种 · 共 {pieces} 件', 0)}</row>"
    )
    excel_row = 3
    rows_xml.append(
        f'<row r="{excel_row}" ht="22" customHeight="1">'
        f"{_inline_cell('A3', '图标', 2)}"
        f"{_inline_cell('B3', '材料', 2)}"
        f"{_inline_cell('C3', '数量', 2)}"
        f"{_inline_cell('D3', '来源', 2)}</row>"
    )
    excel_row = 4

    for group in groups:
        group_name = str(group.get("name") or "材料")
        rows_xml.append(
            f'<row r="{excel_row}" ht="24" customHeight="1">'
            f"{_inline_cell(_col_row(1, excel_row), group_name, 3)}</row>"
        )
        merges.append(f'<mergeCell ref="A{excel_row}:D{excel_row}"/>')
        excel_row += 1
        for item in group.get("rows") or []:
            name = str(item.get("name") or "")
            count = max(0, int(item.get("count") or 0))
            source = str(item.get("source") or group_name)
            png = _decode_icon(item.get("icon") or item.get("iconData") or "")
            rows_xml.append(
                f'<row r="{excel_row}" ht="40" customHeight="1">'
                f'<c r="{_col_row(1, excel_row)}" s="4"/>'
                f"{_inline_cell(_col_row(2, excel_row), name, 4)}"
                f"{_number_cell(_col_row(3, excel_row), count, 5)}"
                f"{_inline_cell(_col_row(4, excel_row), source, 4)}</row>"
            )
            if png:
                images.append((excel_row - 1, png))  # 0-based row for drawing
            excel_row += 1

    merge_xml = ""
    if merges:
        merge_xml = f'<mergeCells count="{len(merges)}">{"".join(merges)}</mergeCells>'
    drawing_tag = '<drawing r:id="rId1"/>' if images else ""
    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<worksheet xmlns="{NS_SS}" xmlns:r="{NS_OD}">'
        '<sheetFormatPr defaultRowHeight="18"/>'
        "<cols>"
        '<col min="1" max="1" width="8" customWidth="1"/>'
        '<col min="2" max="2" width="24" customWidth="1"/>'
        '<col min="3" max="3" width="10" customWidth="1"/>'
        '<col min="4" max="4" width="18" customWidth="1"/>'
        "</cols>"
        f'<sheetData>{"".join(rows_xml)}</sheetData>'
        f"{merge_xml}{drawing_tag}</worksheet>"
    )

    drawing_xml, drawing_rels, media = _drawing_parts(images)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(
            "[Content_Types].xml",
            _content_types(bool(images)),
        )
        zf.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{NS_PKG}">'
            f'<Relationship Id="rId1" Type="{NS_OD}/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        zf.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<workbook xmlns="{NS_SS}" xmlns:r="{NS_OD}">'
            "<sheets>"
            '<sheet name="材料清单" sheetId="1" r:id="rId1"/>'
            "</sheets></workbook>",
        )
        zf.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            f'<Relationships xmlns="{NS_PKG}">'
            f'<Relationship Id="rId1" Type="{NS_OD}/worksheet" Target="worksheets/sheet1.xml"/>'
            f'<Relationship Id="rId2" Type="{NS_OD}/styles" Target="styles.xml"/>'
            "</Relationships>",
        )
        zf.writestr("xl/styles.xml", STYLES_XML)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        if images:
            zf.writestr(
                "xl/worksheets/_rels/sheet1.xml.rels",
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                f'<Relationships xmlns="{NS_PKG}">'
                f'<Relationship Id="rId1" Type="{NS_OD}/drawing" Target="../drawings/drawing1.xml"/>'
                "</Relationships>",
            )
            zf.writestr("xl/drawings/drawing1.xml", drawing_xml)
            zf.writestr("xl/drawings/_rels/drawing1.xml.rels", drawing_rels)
            for name, png in media:
                zf.writestr(f"xl/media/{name}", png)
    return buf.getvalue(), filename


def _content_types(has_drawings: bool) -> str:
    extra = ""
    if has_drawings:
        extra = (
            '<Default Extension="png" ContentType="image/png"/>'
            '<Override PartName="/xl/drawings/drawing1.xml" '
            'ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
        )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f"{extra}"
        '<Override PartName="/xl/workbook.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" '
        'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        "</Types>"
    )


def _drawing_parts(images: list[tuple[int, bytes]]) -> tuple[str, str, list[tuple[str, bytes]]]:
    if not images:
        return "", "", []
    anchors = []
    rels = []
    media = []
    for index, (row0, png) in enumerate(images, start=1):
        rid = f"rId{index}"
        name = f"image{index}.png"
        media.append((name, png))
        rels.append(
            f'<Relationship Id="{rid}" Type="{NS_OD}/image" Target="../media/{name}"/>'
        )
        pic_id = index + 1
        anchors.append(
            "<xdr:oneCellAnchor>"
            "<xdr:from>"
            "<xdr:col>0</xdr:col>"
            f"<xdr:colOff>{ICON_PAD_EMU}</xdr:colOff>"
            f"<xdr:row>{row0}</xdr:row>"
            f"<xdr:rowOff>{ICON_PAD_EMU}</xdr:rowOff>"
            "</xdr:from>"
            f'<xdr:ext cx="{ICON_EMU}" cy="{ICON_EMU}"/>'
            "<xdr:pic>"
            "<xdr:nvPicPr>"
            f'<xdr:cNvPr id="{pic_id}" name="Icon {index}"/>'
            '<xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr>'
            "</xdr:nvPicPr>"
            "<xdr:blipFill>"
            f'<a:blip xmlns:r="{NS_OD}" r:embed="{rid}"/>'
            "<a:stretch><a:fillRect/></a:stretch>"
            "</xdr:blipFill>"
            "<xdr:spPr>"
            f'<a:xfrm><a:off x="0" y="0"/><a:ext cx="{ICON_EMU}" cy="{ICON_EMU}"/></a:xfrm>'
            '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
            "</xdr:spPr>"
            "</xdr:pic>"
            "<xdr:clientData/>"
            "</xdr:oneCellAnchor>"
        )
    drawing = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" '
        'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">'
        f"{''.join(anchors)}</xdr:wsDr>"
    )
    rels_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<Relationships xmlns="{NS_PKG}">{"".join(rels)}</Relationships>'
    )
    return drawing, rels_xml, media
