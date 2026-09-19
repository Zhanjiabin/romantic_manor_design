# 广告牌拼接

在「导入图片 / GIF」或「智能生成」中选择图片或 GIF，再选择四拼、九宫格、横竖长条、L 形、十字形、心形。自定义可调整行列并点击格子留空；行列各不超过 12，实际使用不超过 64 块。左侧「拼接布局」可以调整已有作品的布局，保留原有位置的灯珠。

每块始终为 36×24 灯珠。四拼为 72×48，九宫格为 108×72，整图统一识别、取样，再拆成各块。空缺位置不绘制。左侧的「页」仍是最多 10 页动画，独立于拼接块数；一个动画页包含整幅拼接画面。GIF 取前 10 帧，解码时先合成完整帧，再按整幅拼接画布统一取样；所有帧保留完整范围和背景，防止逐帧裁切造成抖动。导入窗口支持逐帧预览和播放。游戏只有统一间隔，导入时采用所取帧的平均时长（至少 50 毫秒），可在左侧调整；不保留逐帧不同的停顿。应用 GIF 替换整幅作品的动画页，可撤销。ALE 仍导入选中的单块。

画布支持滚轮、双指及按钮缩放，「适应」回到全图。按住鼠标滚轮或使用画布工具可拖动平移。分块线可关闭；在左侧选中要复制的块，桌面也可 Alt+点击选块。「复制页」立即复制该块当前页，「复制全部」复制该块的所有动画页。粘贴页位于「更多操作」。

多块作品点「定稿」下载 ZIP：每块各一份原生 ALE 和游戏「全部粘贴」文本，加上可重新导入本桌的「拼接图纸.json」与摆放说明。单块定稿保持原有 ALE 导出。游戏里需要准备相应数量的广告牌，分别导入/粘贴并摆放。

## 游戏尺寸预览的依据与范围

读取了游戏 `sourceCode/leo/rcsys/basesvr/light/light.cfg` 的高清广告牌分支：`SetDefSize(36,24)`；`AddScaleMode(87,65,-15,-105)` 和 `AddScaleMode(89,65,-15,-80)`。灯珠使用游戏 `svr/light/img/highlight.png#5,11` 的 50 种颜色，50 为关灯。

`data/board_base_0.png` 与 `data/board_base_1.png` 解码自游戏 `sourceCode/leo/rcitem/item_s/100func/高清电子广告牌.ale` 的两个底座帧，原始尺寸分别为 92×58、92×54，锚点分别为 (-18,-45)、(-17,-13)。

预览按以上资源尺寸以 1 CSS 像素显示 1 游戏资源像素，也可放大 2/4 倍检查。左右朝向的斜率 ±0.5 依据等距底座几何与参考截图建立；整图使用同一个仿射变换，确保相邻块共边，不会各自缩放产生接缝。原生 C++ 渲染器的完整源码不在此仓库，所以这是资源尺寸模拟预览，并非运行游戏引擎的截图。游戏窗口缩放、抗锯齿、摆放高度和遮挡可能影响实机观感。

导出坐标以左上位置为参考，横向相邻块偏移 `(屏宽, ±屏宽/2)`，纵向相邻块偏移 `(0, 65)`，单位为屏幕像素，并非庄园地格。游戏内需同向摆放、调整高度并遮住内部底座。本桌不操作游戏自动摆放；各块动画的实际启动时间也可能不同。

## 回归验证

```text
node --test tests/board-mosaic.test.js tests/board-image.test.js tests/board-desk.test.js
python -m pytest tests/test_board.py tests/test_saves.py
python -m pytest tests/test_board_gif.py
node tools/verify-board-mosaic.cjs
node tools/verify-board-gif.cjs
python tools/verify-board-mosaic-export.py _tmp_board_gif/animated-mosaic.zip
python tools/verify-board-mosaic-export.py
node tools/verify-board-history.cjs
node tools/verify-board-image.cjs teaching-sign
```

浏览器验证需本地服务（默认 http://127.0.0.1:8765/web/board.html，可用 BOARD_URL 覆盖），以及 Playwright、Sharp。覆盖四种窗口尺寸、预设与自定义留空、跨接缝笔画、撤销/重做、缩放、两种斜向、作品保存及 JSON 重导入。下载验证会用 Python 标准 ZIP 库和项目原生 ALE 解码器逐颗核对灯珠，再重组整图，检查没有缺行或错位。浏览器输出保存在被忽略的 `_tmp_board_mosaic`。
