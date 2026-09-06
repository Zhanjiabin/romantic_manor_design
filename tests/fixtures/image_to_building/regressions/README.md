# 图片转建筑失败样本（P0 冻结）

把真实失败截图、当时输出的 spec、重渲染图放在本目录对应 `case-xxxx/` 下。二进制原图不要提交聊天压缩版。

每条灾难性失败至少记录：

- 输入有建筑但输出 0 件
- 只有巨大地基
- 所有件集中在角落
- 记录越界
- 预览与 apply 后位置不一致
- 清空了用户原建筑但没有有效替代
- 非法 UID、alias 导出或 `mat=0`

当前仓库已冻结的行为：

1. 无用户手绘结构时，截图模式必须返回「未识别」，不得自动铺 L 墙/2×2 地面。
2. 旧启发式仍可通过 `?imageBuilding=legacy` 或 `localStorage.MANOR_IMAGE_BUILDING_LEGACY=1` 复现。
3. `tests/fixtures/bookshop-layout.json` 仍是结构 spec → 图纸金样，不是截图识别金样。
