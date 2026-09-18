# -*- coding: utf-8 -*-
"""One-shot copy of the building desk into an isolated remodel desk.

Does not modify web/building.js or web/building.html.  Re-run only when you
need to refresh the remodel fork from the building desk snapshot.
"""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"

THEME_ORDER = """const THEME_ORDER = [
  "o_china03",
  "o_military03",
  "o_military02",
  "o_q02",
  "i_xmas03",
  "i_xmas02",
  "i_tool02",
];"""

BASE_KIND_TABS = """const BASE_KIND_TABS = [
  { kind: 0, label: "装饰" },
  { kind: 1, label: "家具" },
  { kind: 2, label: "椅子" },
  { kind: 3, label: "床" },
];"""

NATIVE_HELPERS = r'''
function designBases() {
  return state.catalog?.building?.customBases || [];
}

/** Native GetBaseIndex(kind, "SetPut(putw,puth)") from customroot.tab. */
function nativeGetBaseIndex(kind, putw, puth) {
  const needle = `SetPut(${Number(putw) || 0},${Number(puth) || 0})`;
  return (
    designBases().find((base) => {
      if (Number(base.kind) !== Number(kind)) return false;
      return String(base.command || "").replace(/\s+/g, "").includes(needle);
    }) || null
  );
}

function nativeScaleMode(kind) {
  return Number(kind) >= 1 ? 2 : 0;
}

function nativeUserAction(kind) {
  const value = Number(kind);
  if (value === 2) return "坐椅子";
  if (value === 3) return "躺";
  return "";
}

function syncShowManChecks() {
  const kind = Number(state.base?.kind) || 0;
  const show = kind >= 2;
  if (!show) {
    state.showMan = false;
    state._lastShowManKind = kind;
  } else if (state._lastShowManKind !== kind) {
    state.showMan = true;
    state._lastShowManKind = kind;
  }
  const selectBox = document.getElementById("showMan");
  const designBox = document.getElementById("showManDesign");
  if (selectBox) selectBox.checked = !!state.showMan;
  if (designBox) designBox.checked = !!state.showMan;
  const field = document.getElementById("showManField");
  if (field) field.hidden = !show;
  const designField = document.getElementById("showManDesignField");
  if (designField) designField.hidden = !show || state.phase !== "design";
}

function applyRemodelKindRules(base = state.base) {
  const kind = Number(base?.kind) || 0;
  state.scaleMode = nativeScaleMode(kind);
  state.userAction = nativeUserAction(kind);
  syncShowManChecks();
  const clip = document.getElementById("remodelClipNote");
  if (clip) clip.hidden = state.phase !== "design";
}

window.RemodelNative = {
  designBases,
  nativeGetBaseIndex,
  nativeScaleMode,
  nativeUserAction,
};
'''


def replace_between(text: str, start: str, end: str, new: str) -> str:
    i = text.find(start)
    j = text.find(end, i)
    if i < 0 or j < 0:
        raise SystemExit(f"block not found: {start!r}")
    return text[:i] + new + text[j:]


def patch_js(src: str) -> str:
    text = src
    text = replace_between(text, "const THEME_ORDER = [", "const BASE_KIND_TABS = [", THEME_ORDER + "\n")
    text = replace_between(text, "const BASE_KIND_TABS = [", "const CUSTOMS_KEY =", BASE_KIND_TABS + "\n")
    text = text.replace("manor-building-", "manor-remodel-")
    text = text.replace("/api/saves/building", "/api/saves/remodel")
    text = text.replace("/data/building_pack_uids.json", "/data/item_pack_uids.json")
    text = text.replace("bootBuilding", "bootRemodel")
    text = text.replace("建筑设计桌", "改造设计桌")
    text = text.replace("请先选择户型。", "请先选择基座。")
    text = text.replace("还没选户型", "还没选基座")
    text = text.replace("请先选择建筑户型。", "请先选择改造基座。")
    text = text.replace("图纸原户型", "图纸原基座")
    text = text.replace("只换户型", "只换基座")
    text = text.replace(
        'state.packs = sortThemes(catalog.building.packs.filter((pack) => pack.kind === "theme"));',
        'state.packs = sortThemes(catalog.building.packs.filter((pack) => pack.kind === "item"));',
    )
    text = text.replace(
        """  state.indexedPacks = (catalog.building.packs || []).filter(
    (pack) => pack.kind === "theme" || pack.kind === "item"
  );""",
        """  state.indexedPacks = (catalog.building.packs || []).filter(
    (pack) => pack.kind === "item"
  );""",
    )
    text = text.replace(
        """  state.base =
    catalog.building.bases.find((base) => base.kind === 0) || catalog.building.bases[0] || null;""",
        """  state.base =
    designBases().find((base) => base.kind === 0) || designBases()[0] || null;""",
    )
    text = text.replace(
        """function basesOfKind(kind) {
  return (state.catalog?.building?.bases || [])
    .filter((base) => base.kind === kind)
    .sort((a, b) => (a.no || 0) - (b.no || 0));
}""",
        """function basesOfKind(kind) {
  return designBases()
    .filter((base) => base.kind === kind)
    .sort((a, b) => (a.no || 0) - (b.no || 0));
}""",
    )
    text = text.replace(
        "  const bases = state.catalog?.building?.bases || [];",
        "  const bases = designBases();",
    )
    text = text.replace(
        '        return pack?.kind === "theme" ? pack.key : "";',
        '        return pack?.kind === "item" ? pack.key : "";',
    )
    text = text.replace(
        '        if (pack.kind === "theme") lastTheme = pack;',
        '        if (pack.kind === "item") lastTheme = pack;',
    )
    text = text.replace(
        """async function beginDesign() {
  houseSelectBackup = null;
  if (!state.base) {""",
        """async function beginDesign() {
  houseSelectBackup = null;
  applyRemodelKindRules(state.base);
  if (!state.base) {""",
    )
    text = text.replace(
        """  fillBaseMaterials(base);
  syncDesignResetButtons();
  const preview = document.getElementById("basePreviewImg");""",
        """  fillBaseMaterials(base);
  applyRemodelKindRules(base);
  syncDesignResetButtons();
  const preview = document.getElementById("basePreviewImg");""",
    )
    marker = "function assetKey(component, pack = component?._pack || state.pack) {"
    if marker not in text:
        raise SystemExit("assetKey not found")
    if "function designBases()" not in text:
        text = text.replace(marker, NATIVE_HELPERS + "\n" + marker)
    header = "/* Isolated remodel desk. Generated from a building-desk snapshot; do not edit building.js. */\n"
    if not text.startswith(header):
        text = header + text
    return text


def patch_html(src: str) -> str:
    text = src
    text = text.replace("建筑设计桌", "改造设计桌")
    text = text.replace('class="app building-app phase-select" id="buildingApp"',
                        'class="app building-app remodel-app phase-select" id="buildingApp"')
    text = text.replace(
        '  <link rel="stylesheet" href="/web/building.css?v=201" />',
        '  <link rel="stylesheet" href="/web/building.css?v=201" />\n'
        '  <link rel="stylesheet" href="/web/remodel.css?v=1" />',
    )
    text = text.replace(
        '          <a class="on" href="/web/building.html" aria-current="page">建筑<span class="desk-switch-rest">设计桌</span></a>\n'
        '          <a href="/web/cloth.html">衣服<span class="desk-switch-rest">设计桌</span></a>\n'
        '          <a href="/web/board.html">广告牌<span class="desk-switch-rest">设计桌</span></a>',
        '          <a href="/web/building.html">建筑<span class="desk-switch-rest">设计桌</span></a>\n'
        '          <a href="/web/cloth.html">衣服<span class="desk-switch-rest">设计桌</span></a>\n'
        '          <a class="on" href="/web/remodel.html" aria-current="page">改造<span class="desk-switch-rest">设计桌</span></a>\n'
        '          <a href="/web/board.html">广告牌<span class="desk-switch-rest">设计桌</span></a>',
    )
    text = text.replace("选择户型", "选择基座")
    text = text.replace("当前户型", "当前基座")
    text = text.replace("先选户型，再点「开始设计」", "先选基座大小，再点「开始设计」")
    text = text.replace("点这里选户型", "点这里选基座")
    text = text.replace("户型", "基座")
    text = text.replace("保留地基", "显示基座")
    text = text.replace(
        '            <button type="button" class="btn btn-wide" id="btnPlaceOnTerrain" title="把当前建筑和户型一起放到地形设计桌预览">放到地形桌</button>\n',
        "",
    )
    text = text.replace(
        '          <div class="hud-stack" id="hudStack">\n'
        '            <div class="base-meta" id="baseMeta">',
        '          <div class="hud-stack" id="hudStack">\n'
        '            <p class="remodel-clip-note" id="remodelClipNote" hidden>注意！超出亮光部分会被剪裁</p>\n'
        '            <div class="base-meta" id="baseMeta">',
    )
    text = text.replace(
        '            <button type="button" class="btn btn-primary btn-block" id="btnNextBase">开始设计</button>',
        '            <p class="remodel-kind-hint">游戏按家具占地 <code>SetPut(putw,puth)</code> 从 46 个基座里选，装饰 / 家具 / 椅子 / 床各有一套大小。</p>\n'
        '            <label class="check remodel-showman" id="showManField" hidden>\n'
        '              <input type="checkbox" id="showMan" />\n'
        '              <span>显示人物</span>\n'
        '            </label>\n'
        '            <button type="button" class="btn btn-primary btn-block" id="btnNextBase">开始设计</button>',
    )
    text = text.replace(
        '                <button type="button" class="on" data-paper-kind="all" aria-selected="true">全部</button>\n'
        '                <button type="button" data-paper-kind="desk" aria-selected="false">建筑</button>\n'
        '                <button type="button" data-paper-kind="terrain" aria-selected="false">地形</button>',
        '                <button type="button" class="on" data-paper-kind="all" aria-selected="true">全部</button>\n'
        '                <button type="button" data-paper-kind="desk" aria-selected="false">改造</button>',
    )
    text = text.replace(
        '  <script src="/web/paper-library-core.js?v=22"></script>',
        '  <script src="/web/remodel-paper-library-core.js?v=1"></script>',
    )
    text = text.replace(
        '  <script src="/web/building.js?v=280"></script>',
        '  <script src="/web/remodel.js?v=1"></script>',
    )
    text = text.replace('aria-label="建筑设计画布"', 'aria-label="改造设计画布"')
    return text


def main() -> None:
    js = patch_js((WEB / "building.js").read_text(encoding="utf-8"))
    html = patch_html((WEB / "building.html").read_text(encoding="utf-8"))
    core = (WEB / "paper-library-core.js").read_text(encoding="utf-8")
    core = core.replace('const API = "/api/saves/building/papers";', 'const API = "/api/saves/remodel/papers";')
    core = core.replace('const SORT_STORAGE_KEY = "manor-paper-library-sort";', 'const SORT_STORAGE_KEY = "manor-remodel-paper-library-sort";')
    (WEB / "remodel.js").write_text(js, encoding="utf-8")
    (WEB / "remodel.html").write_text(html, encoding="utf-8")
    (WEB / "remodel-paper-library-core.js").write_text(core, encoding="utf-8")
    print("wrote web/remodel.js", len(js.splitlines()), "lines")
    print("wrote web/remodel.html", len(html.splitlines()), "lines")
    print("wrote web/remodel-paper-library-core.js")


if __name__ == "__main__":
    main()
