# GTile 地形管线证据

## 已确认

### 1. 主贴图导入

`0x521050` 是普通地形贴图的导入入口。它读取图片宽高，并按以下规则建立 tile 缓存：

```text
columns = ceil(imageWidth / 64)
row     = floor(index / columns)
column  = index % columns
sourceX = column * 64 + (row is odd ? 32 : 0) + offsetX
sourceY = row * 16 + offsetY
valid   = sourceX + 65 <= imageWidth
       && sourceY + 33 <= imageHeight
```

每个有效源区域通过 `0x520850` 变成 65×33 菱形对象，热点为
`(-32,-16)`。因此 256×129 的 `c01.jpg` 会得到 21 个有效变体：

```text
y= 0: x=0,64,128
y=16: x=32,96,160
y=32: x=0,64,128
y=48: x=32,96,160
y=64: x=0,64,128
y=80: x=32,96,160
y=96: x=0,64,128
```

这直接排除了把 c01 当 256×129 矩形壁纸循环的模型。

### 2. 蒙版导入不是 c01 选帧

`0x521390` 使用 `0x5DB984` / `0x5DB9D0` 的表和 3 列交错坐标。
它服务于 192×226 的蒙版图（`989802.jpg` / `__mask.jpg` 路径），
不是 c01 的运行时选帧公式。此前把这段逻辑套到 c01 是错误的。

### 3. 地形笔刷到 tile 网格

`GBkTile::PaintTileEx` 在 `0x4C4091` 调用 `0x4C2C40`。后者用
`(2*x + y + 32) / 64` 与 `(2*x - y + 32) / 64` 一类变换求受影响
的等距 tile 范围，再把四方向连接标志写入格子。`0x4C5F80`
则是除以 3 的空间查询/最近点代码，不是贴图缩放器。

### 4. 输出阶段

`0x460F30` / `0x461300` 属于图像/DIB 对象和屏幕输出链；
`0x48DD40` 落在包含它的函数内部，不是独立函数入口。静态调用关系
由 `gtile_pipeline_probe.py` 重复导出。

## 网页实现采用的明确规则

```text
tile(column,row)
  -> hash(column,row,texture)
  -> c01 的 21 个 sourceDiamond 之一
  -> screenAnchor = (column*64 + odd(row)*32, row*16) * textureScale
  -> draw hotspot (-32,-16), envelope 65x33
```

草地装饰变体使用固定坐标哈希稀疏选取；它不会修改 c01 像素，也不会
在每个地块注入花朵。纹理物理倍率与 UI 缩放分离。

## 光照与过渡

- `990000.jpg` 是 1024×512、每通道约 0–26 的低位深宽尺度图。
  它和原版截图在约 0.6–0.625 倍出现同相相关峰，适合作为低增益
  加法光照，而不是普通 RGB multiply 图。
- `989802.jpg` 是 192×226 的过渡形态/权重图。它只参与不同地形
  相邻时的连接图生成；纯草地不得覆盖该图。
- ALE `linkall` 仍由相邻地形触发，纯草地基准不绘制连接层。

## 可重复验证

```powershell
python tools/gtile_pipeline_probe.py
python tools/terrain_probe.py
```

第一条只读 rc3.exe 并输出调用关系；第二条生成模型量化报告。原始
游戏资源不会被修改或启动。
