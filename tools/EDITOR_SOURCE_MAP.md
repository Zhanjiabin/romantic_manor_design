# 原版双设计桌证据索引

本文件只记录可由解包文件或 `rc3.exe` 验证的事实。网页实现不得用截图猜测替代这里列出的数据源。

## 资源盘点

运行：

```powershell
python tools/build_editor_catalog.py
```

生成：

- `data/editor_catalog.json`：网页可消费的完整原版资源目录。
- `data/editor_catalog_report.json`：缺失引用、未支持格式和数量统计。

当前解包树包含：

- 地形设计笔刷 30 项，来源 `mapdata.tab`。
- 地图尺寸 16 项，来源 `mapsize.tab`。
- 地形配置 41 套，共 1916 条 `addkind`、827 条 `linkall`。
- 建筑户型 80 项、物件基座 46 项。
- 建筑/物件素材包 32 套，共 2980 个组件、86 个内置模板。
- 建筑 ALE 中 2761 个为 `AEX\0`，另有 159 个为原生 `ALE\0`。
- 已逐帧实解 2906 个唯一素材文件；其中 2891 个（6535 帧）可输出 RGBA。
  `tds` 包的 15 个塔类 AEX 使用 `0:;dx=...;fight=true` 开头的自定义像素流，
  并非 JPEG/GIF 图像平面，仍需补专用解码器。

## 地形设计桌

### UI 与操作

- `sourceCode/leo/rcsys/svr/mapdesign/design.cfg`
  - 原始窗口为 800×600。
  - 地图区为 581×551，缩略图为 133×112。
  - 定义地形描述、地块类型、参数列表、费用、显示建筑模型、显示编辑信息、导入、保存和制作按钮。
  - `MakeMap`、`ChgMapSize`、`MapMult` 等核心对象方法由原生类实现，脚本只负责接线。

### 可选笔刷

- `sourceCode/leo/rcsys/svr/mapdesign/basedata/mapdata.tab`
  - 设计桌只展示这里的 30 项，不等于地图 INI 中全部运行时地块。
  - 每项包含系统名、显示名、地块代码、1/3/5 格笔刷、图标帧、单次价格和类型。
- `sourceCode/leo/rcsys/svr/mapdesign/basedata/mapsize.tab`
  - 800 到 5000 的 16 种地图边长、等级、基础价格和说明。

### 渲染

- `sourceCode/leo/rcex/maps/tile/*.ini`
  - `addkind`：可行走标志、地块代码、地块类型和纹理。
  - `linkall`：有方向的地块过渡关系及 ALE/PNG 边缘资源。
  - `mask`、`light`、`水动画`：全局遮罩、光照和水帧。
- `tools/GTILE_PIPELINE.md`
  - 已确认 AEX 地块导入、65×33 菱形包络和 `c01.jpg` 的 21 个有效源区域。

仍需从原生实现确认：

- GTile 变体选择是否依赖坐标、导入顺序或内部随机表。
- 多层 `linkall` 的精确优先级与组合顺序。
- `GMapDesign` 的费用累计、传送门和建筑模型覆盖规则。

## 建筑设计桌

### UI 与模式

- `sourceCode/leo/rcsys/svr/bdesign/builddesign.cfg`
  - 普通建筑设计桌、快速设计、户型选择、素材列表、模板列表和预览。
  - 主设计层是 570×550 的 `GDesignLayer`。
  - 原版工具包括到底层、到下层、到上层、到顶层、删除、撤销、重做、翻转和拆散套件。
- `sourceCode/leo/rcsys/svr/bdesign/adorndesign.cfg`
  - 高级装饰设计，增加可达格、禁行格、保留地基和人物参照。
- `sourceCode/leo/rcsys/svr/bdesign/itemdesign.cfg`
  - 装饰、家具、椅子和床等物件设计。
- `sourceCode/leo/rcsys/svr/bdesign/script/svr_designguide.txt`
  - 素材包下载、户型过滤、材料统计、预览及设计对象创建流程。

### 户型与素材

- `sourceCode/leo/rcsys/svr/bdesign/imgs/base.tab`
  - 80 个建筑/装饰户型，包含空间、评价、锚点、地基图、遮罩、室内地图、占地和基础材料。
- `sourceCode/leo/rcsys/svr/bdesign/item/customroot.tab`
  - 46 个物件基座。
- `sourceCode/leo/rcex/svr/bdesign/res/*/mat.cfg`
  - 建筑主题包。
- `sourceCode/leo/rcex/svr/bdesign/item/*/mat.cfg`
  - 物件主题包。
- 组件 ID 百位定义原版分类：
  - 1xx 装饰
  - 2xx 门窗
  - 3xx 地面
  - 4xx 屋顶
  - 5xx 墙壁
  - 6xx 套件

### 建筑图纸

普通组件记录为 `V1;` 后若干九字符记录。当前已确认：

- 记录顺序参与绘制层级。
- `rc3.exe` 在 `0x4229c0` 初始化紧凑整数表，字母表顺序为
  `0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ_` + 反引号 + `abcdefghijklmnopqrstuvwxyz`。
- `GDesignLayer` 的记录加载路径位于 `0x668e00`。
- 前 5 个字符不是“标志 + 两个双字符坐标”。原生 `0x425370` 将它整体解码成
  30 位整数，再拆为两个无符号 15 位 x/y；`0x4252f0` 是对应编码器。
- 第 6–8 个字符直接解码为当前 `mat.cfg` 的 1xx–5xx 组件 ID。这里不存在另一套
  待求解的 Link UID。
- 保存坐标是当前帧实际矩形的左上角；ALE anchor/透明边界由原生加载时补偿，
  网页直接把对应帧 PNG 左上角绘制到该坐标。
- 原版 `mat.cfg` 内置套件/模板的 5899 条记录用该字母表解码后，除三套原始资源自身
  缺少的 3 个组件键外，全部直接命中同包素材表。
- 最后一位是素材帧/方向状态；原生按 `(state + 1) % frameCount` 循环，
  两帧素材常表现为镜像，但不能统一当作布尔翻转。
- `mat.cfg` 中 6xx “素材”可能直接保存另一段 `V1;`，表示可拆散套件，不是 ALE 文件路径。

仍需从 `GDesignLayer` 确认：

- 少量 327xx 离屏坐标的历史用途。
- 各素材帧状态的具体视觉语义。
- 地基亮区裁剪、不可见对象和高级地格的序列化。

## 文件边界

以下三种内容不能混为一种格式：

1. 地形桌：`模板=(kind,x,y,...);size=...;mapflag=...`
2. 建筑组件桌：`V1;` 九字符组件记录
3. 庄园物件摆放：同为 `V1;`，但字段是世界坐标、物品 ID 和方向

原版没有地形与建筑组件的合体文件。统一外部编辑器可以在工程层关联它们，但向游戏导出时仍必须分别生成原版文件。
