# 浪漫庄园「图片转建筑」重构执行规格（交给 Grok）

版本：v1.0  
状态：实施规格，不是效果承诺  
适用仓库：`D:\game\浪漫庄园-外部设计桌`  
目标硬件：

- 线上：8 vCPU、16 GB RAM、无 GPU。
- 开发/训练机：Intel i5-13600KF、64 GB RAM、RTX 3060 Ti 8 GB。
- 客户端：桌面浏览器、360×640 / 390×844 手机竖屏、844×390 横屏、768×1024 平板。

---

## 0. 给 Grok 的第一原则

这不是“看图后凭经验拼一个差不多的建筑”，而是一个闭集逆向渲染问题：

```text
已知素材全集 + 已知户型 + 已知渲染规则 + 输入截图
    -> 恢复可观察素材的 mat/state/x/y/前后顺序
    -> 用同一渲染器重新渲染
    -> 以重渲染残差和图纸真值共同验收
```

必须先完成 CPU 传统视觉与逆向渲染基线。只有基线证明“正确素材经常出现在 Top-K，但排第一不够准”时，才允许训练模型。禁止从第一天开始训练一个截图到图纸的端到端黑盒。

任何阶段都不得把“输出了东西”当作成功。当前版本就是因为强制输出地基、L 墙和第一件候选，才会出现看似运行正常、实际 0% 可用。

---

## 1. 产品目标和不可承诺事项

### 1.1 三类输入必须分开

#### A 类：设计桌干净截图

特征：

- 使用本项目或同版本设计桌渲染。
- 户型已知。
- 等距视角固定。
- 最好是 PNG、未裁切、无浏览器缩放。

目标：

- 恢复所有“截图中确实可观察”的素材。
- 在视觉等价素材允许归为同一等价组时，Top-5 候选召回达到 98%。
- 少量人工确认后，95% 的合格截图可生成可导入、可编辑图纸。

#### B 类：游戏内截图

特征：

- 可能有 UI、草地、人物、透明户型框、缩放、裁切、JPEG。
- 户型由用户选择或确认。

目标：

- 自动定位可见实例和候选素材。
- 低置信实例要求用户从 Top-5 中选择。
- 不承诺恢复完全遮挡、被裁掉或视觉不可区分的原始记录。

#### C 类：手绘、现实照片、非游戏参考图

这类输入没有原始游戏 `mat` 真值，不能称为“还原”。

目标必须改名为：

- “参考图辅助拼搭”；
- 用户先画/修正地面、墙、门窗和装饰锚点；
- 系统按主题提供游戏素材候选并生成同类结构。

不得把 C 类与 A/B 类准确率混在一起。

### 1.2 “95%”的正式定义

禁止宣传“任意单张截图 95% 全自动恢复整张原图纸”。原因：

- 完全遮挡记录不可观察；
- 多个 UID、local 或 state 可能渲染出相同像素；
- 截图裁切后绝对坐标可能不可恢复；
- 单件准确率 95% 时，20 件建筑整图全对概率只有约 36%。

本项目的主指标定义为：

> 在冻结的合格真实截图验收集上，至少 95% 的截图能在不超过 3 分钟、且人工修改不超过 `max(2, ceil(记录数×5%))` 的条件下，得到可导入、可编辑、视觉对齐的图纸。

同时必须分别报告：

1. 纯自动实例 F1。
2. 正确素材 Top-1 命中率。
3. 正确素材 Top-5 命中率。
4. 坐标误差。
5. 自动接受覆盖率。
6. 人工修正后的工作流成功率。
7. 灾难性失败率。

禁止把第 6 项写成“自动准确率”。

---

## 2. 永久不可违反的领域规则

Grok 每次开始新阶段前都必须重新阅读：

- `.cursor/rules/building-pack-uids-locked.mdc`
- `.cursor/rules/building-base-frame-locked.mdc`
- `.cursor/rules/mobile-workspace-required.mdc`

以下规则是发布阻断项。

### 2.1 UID 规则

1. `mat = uid * 1000 + local`。
2. 权威映射只能读取 `data/building_pack_uids.json` 的 `mapping`。
3. 不得修改 1、2、3、4、5、7、8、10、11、12、13、14、15、16、18、19、20、21、25、26、27、28 的现有映射。
4. `aliases` 只允许解码。6、9、17 不得作为新图纸的导出 UID。
5. 缺失 local 必须保持缺失，禁止跨包借用 `框架`。
6. `native.frameBorrow` 永远保持 `false`。
7. `mat=0` 是人物引用，不是户型、原点或地基。自动生成记录不得包含 `mat=0`。

### 2.2 户型与坐标规则

1. 户型外框必须使用现有 `maskimg`，不得重建六边形，不得拉伸或缩放 mask。
2. `baseimg` 的实体前顶点贴到 mask 前顶点，算法复用 `floorSnugInMask` 语义。
3. 导入截图不得移动户型框去追随素材。
4. 图纸 desk 坐标底层是 signed 15-bit：`-16384..16383`。
5. 产品自动输出仍限制在用户验证的有效设计区域，默认只接受 `0≤x,y≤2047`；越界候选必须拒绝，不得 clamp 后假装正确。
6. 记录中的 `x/y` 是精灵图像左上角位置，不是脚点。脚点和左上角之间必须通过统一 foot 模型转换。
7. 不得从 `mat=0`、素材包围盒或最底部像素猜户型原点。

### 2.3 state、frame 与深度

1. `state` 是图纸字段，范围 0–63。
2. 不得未经验证就声明 `state == ALE frame`。
3. 当前浏览器预览使用 `state % frameCount` 取帧，这只是现有行为，不等于游戏真值。
4. 必须建立 `state -> resolved frame -> visual equivalence group` 清单。
5. 图纸记录顺序是真实绘制顺序；`x+2y` 只能做先验，不能替代真值。
6. 完全遮挡实例不得作为单截图必须恢复的目标。

### 2.4 移动端规则

1. 主触点至少 44×44 CSS px。
2. 使用 Pointer Events 和 pointer capture。
3. 单指操作当前工具，双指平移缩放且不产生误编辑。
4. 对话框/底部 sheet 必须焦点陷阱、恢复焦点、支持 Escape、覆盖时背景 inert。
5. 不得禁用浏览器缩放。
6. 必须复用 `web/mobile-workspace.css` / `web/mobile-workspace.js`、safe-area 和 visualViewport。

---

## 3. 现有代码的处理边界

### 3.1 可以复用

- `codec/ale.py`
  - `parse_ale`
  - `ale_to_rgba`
  - ALE/AEX 全帧像素解码
- `codec/building.py`
  - desk 图纸解析、signed-15 坐标、GBK 无损回写
- `web/building-preview.js`
  - `resolveComponent`
  - `spriteUrl`
  - `frameGeometry`
  - `opaqueDiamondVertices`
  - `floorSnugInMask`
  - `renderPaper`
- `web/building.js`
  - `stampFootOffset`
  - `appendSpriteStamp`
  - 当前图纸历史记录、选择、预览和写入流程
- `web/building-interactions.js`
  - `sceneToIso`
  - `isoToScene`
  - `collectStampPoints`
  - `snapMove`
  - `createViewportTransform`
- `web/codec.js`
  - `parseV1`
  - `formatV1`
  - `decodeS15`
  - `unpackDeskCoordinates`
  - `packDeskCoordinates`
- `data/building_pack_uids.json`
- `data/editor_catalog.json`
- 现有登录与用户隔离机制
- 当前图片转建筑对话框的双画布外壳

服务端还可参考 `server.py` 已有的 `_ALE_PNG_LOCK`、`_ALE_PNG_INFLIGHT`、`_png_cached` 单飞缓存模式，但图片转换必须使用独立 job/worker，不能直接照搬成占用请求线程的长任务。

### 3.2 必须停用或重写

- `web/building-image-convert.js` 中截图主算法：
  - `estimateStructure`
  - `matchScreenshot`
  - screenshot 分支里的 `assembleSketch`
  - `mustPick`
  - 固定 2×2 地面平铺
  - 按 bbox 虚构 L 墙
- `classifySource`：当前用 alpha 邻域推断等距/正交，不能作为生产判断。
- 当前 `stampFoot`/`recordFromFoot`：必须与 desk 的 foot 模型统一。
- `isGoldLike`：只能作为旧测试辅助，不得作为新质量门。
- 当前真实截图模式的同步浏览器计算：改成异步服务端 job。

### 3.3 旧入口的过渡处理

在新基线通过前：

1. 线上按钮标记“实验性”。
2. 默认禁止“一键替换当前建筑”。
3. 无高置信记录时显示“未识别”，不得生成默认地基或默认墙。
4. 旧模式放在 feature flag 后：

```text
MANOR_IMAGE_BUILDING_V2=0
```

新模式通过阶段验收后才改为 1。

---

## 4. 总体架构

```text
浏览器
  ├─ 选择户型、主题范围和输入类型
  ├─ 上传原图
  ├─ 轮询 job
  ├─ 原图/重渲染/差异图三联预览
  └─ 对低置信实例做 Top-5 选择、拖脚点、改 state、增删

HTTP server（现有 ThreadingHTTPServer）
  ├─ 认证、限流、图片校验
  ├─ 创建/读取/取消 job
  └─ 不做重计算

独立 CPU worker（线上默认只有 1 个并发）
  ├─ 预处理与户型配准
  ├─ 候选检测
  ├─ 全分辨率素材检索
  ├─ renderer-in-the-loop 求解
  ├─ 置信度与拒答
  └─ 输出候选图纸、差异图、未识别项

离线数据工具
  ├─ 全帧素材 manifest
  ├─ Python 权威渲染器
  ├─ 合成数据生成
  ├─ 金样评测
  └─ 可选训练/ONNX 导出
```

线上生产环境不得安装 PyTorch、CUDA 或训练依赖。生产只允许：

- Pillow
- NumPy
- opencv-python-headless
- 可选 SciPy
- 可选 onnxruntime（进入模型阶段后）

训练依赖单独放 `requirements-ml.txt`。

---

## 5. 建议的新目录和文件

Grok 不要把所有代码继续塞进 `server.py` 或 `building-image-convert.js`。

```text
image_to_building/
  __init__.py
  schema.py
  asset_manifest.py
  foot_model.py
  renderer.py
  preprocess.py
  registration.py
  candidate_generation.py
  template_matcher.py
  scene_solver.py
  confidence.py
  metrics.py
  job_store.py
  service.py

tools/
  build_sprite_manifest_v2.py
  build_state_frame_map.py
  verify_renderer_parity.py
  generate_building_dataset.py
  evaluate_image_to_building.py
  benchmark_image_to_building.py
  collect_hard_cases.py

worker/
  image_building_worker.py

ml/
  dataset.py
  augment.py
  train_detector.py
  train_retriever.py
  export_onnx.py
  calibrate_confidence.py

web/
  building-image-client.js
  building-image-workbench.js

data/image_to_building/
  manifests/
  state_maps/
  equivalence/
  descriptors/
  models/

tests/image_to_building/
  test_manifest.py
  test_foot_model.py
  test_renderer.py
  test_registration.py
  test_template_matcher.py
  test_solver.py
  test_metrics.py
  test_jobs.py
  test_api.py
```

大图片、全量训练集、模型权重和用户上传原图不得直接提交 Git。Git 只提交：

- schema；
- 小型 fixtures；
- manifest；
- 哈希清单；
- 评测摘要；
- 必要的轻量 ONNX（确认仓库策略后）。

---

## 6. 核心数据格式

所有 schema 必须有整数 `schemaVersion`，所有产物必须记录：

- `uidMappingSha256`
- `editorCatalogSha256`
- `assetManifestSha256`
- `rendererVersion`
- `algorithmVersion`
- 若使用模型：`modelVersion`

### 6.1 素材帧 manifest：`sprite_manifest_v2.jsonl`

每行一个实际 ALE frame：

```json
{
  "schemaVersion": 2,
  "assetId": "bazaar:302:1",
  "pack": "bazaar",
  "uid": 14,
  "local": 302,
  "canonicalMat": 14302,
  "decodeOnlyAliasMats": [],
  "category": "墙壁",
  "file": "wall02.ale",
  "aleSha256": "…",
  "frame": 1,
  "width": 58,
  "height": 72,
  "anchorX": -31,
  "anchorY": -63,
  "opaqueBbox": [2, 3, 55, 69],
  "footOffset": [28.5, 63.5],
  "alphaArea": 1812,
  "rgbaPath": "frames/bazaar/302/1.png",
  "alphaPath": "alpha/bazaar/302/1.png",
  "rgbaSha256": "…",
  "exactPixelGroup": "px:…",
  "nearVisualGroup": "nv:…",
  "legalStates": [1],
  "stateVisualGroup": "svg:…",
  "descriptors": {
    "hsvHistPath": "…",
    "edgePath": "…",
    "orbPath": "…"
  }
}
```

要求：

1. 遍历所有 frame，禁止 `min(2, frames)`。
2. 保留未 trim 的原始 frame 几何，同时另存 trim 图用于检索。
3. foot offset 必须由共享 Python 实现计算，不得继续从 JS 私有函数复制一份不同逻辑。
4. 精确像素组按尺寸、RGBA 字节哈希建立。
5. 近似视觉组只用于评测和候选展示，不能改写 canonical mat。

### 6.2 state 映射：`state_frame_map.json`

```json
{
  "schemaVersion": 1,
  "assetId": "bazaar:302",
  "states": {
    "0": {"resolvedFrame": 0, "visualGroup": "svg:a"},
    "1": {"resolvedFrame": 1, "visualGroup": "svg:b"},
    "2": {"resolvedFrame": 0, "visualGroup": "svg:a"}
  },
  "evidence": "preview-modulo-and-paper-replay",
  "verified": false
}
```

在没有游戏侧证据时 `verified` 必须是 false。输出可选择视觉正确的 canonical state，但评测必须同时报告：

- exact state；
- visual-equivalent state。

### 6.3 场景真值：`scene.json`

```json
{
  "schemaVersion": 1,
  "sceneId": "sha256:…",
  "paperId": "sha256:…",
  "domain": "synthetic_clean",
  "splitGroup": "paper-sha256",
  "baseNo": 212,
  "capture": {
    "image": "image.png",
    "width": 1170,
    "height": 844,
    "format": "png",
    "source": "desk",
    "scale": 1.0,
    "crop": [0, 0, 1170, 844],
    "jpegQuality": null
  },
  "transform": {
    "paperToImage": [1, 0, 0, 1, 0, 0],
    "imageToPaper": [1, 0, 0, 1, 0, 0]
  },
  "instances": [
    {
      "instanceId": 17,
      "mat": 14302,
      "canonicalMat": 14302,
      "state": 1,
      "resolvedFrame": 1,
      "x": 391,
      "y": 218,
      "footX": 420,
      "footY": 279,
      "zIndex": 26,
      "bbox": [320, 180, 418, 286],
      "visibleFraction": 0.64,
      "visibleMask": "masks/17-visible.png",
      "amodalMask": "masks/17-amodal.png",
      "occludedBy": [19, 22],
      "observable": true
    }
  ]
}
```

### 6.4 推理结果

```json
{
  "schemaVersion": 1,
  "jobId": "…",
  "status": "needs_review",
  "baseNo": 212,
  "records": [
    {
      "mat": 14302,
      "state": 1,
      "x": 391,
      "y": 218,
      "footX": 420,
      "footY": 279,
      "confidence": 0.94,
      "autoAccepted": true,
      "candidateSetId": "c17"
    }
  ],
  "candidateSets": {
    "c17": [
      {"mat": 14302, "state": 1, "score": 0.94, "reason": ["masked_ncc", "edge", "render_gain"]},
      {"mat": 14508, "state": 1, "score": 0.81, "reason": ["shape_near"]}
    ]
  },
  "unresolved": [
    {"region": [100, 80, 140, 130], "reason": "top5_below_threshold"}
  ],
  "quality": {
    "explainedPixelRatio": 0.88,
    "edgeF1": 0.91,
    "meanConfidence": 0.89,
    "catastrophic": false
  },
  "artifacts": {
    "render": "…",
    "diff": "…"
  }
}
```

`autoAccepted=false` 的候选不得直接写进图纸。

---

## 7. 阶段 P0：冻结失败基线

预计 0.5–1 天。

### 7.1 代码任务

1. 给当前入口加 feature flag。
2. 保存用户已经反馈失败的原图、旧输出 spec、旧重渲染图作为 `tests/fixtures/image_to_building/regressions/`。
3. 将以下现象定义为 catastrophic：
   - 输入有建筑但输出 0 件；
   - 只有巨大地基；
   - 所有件集中在角落；
   - 记录越界；
   - 预览与 apply 后位置不一致；
   - 清空了用户原建筑但没有有效替代；
   - 非法 UID、alias 导出或 `mat=0`。
4. 旧算法不得继续调阈值冒充新方案。

### 7.2 阶段门槛

- 失败样本能够被一条评测命令重复运行。
- 当前旧算法的分数被记录为 baseline。
- 新实现每阶段都与 baseline 比较。

---

## 8. 阶段 P1：全帧素材库和统一 foot 模型

预计 2–4 天。

### 8.1 重写索引工具

新建 `tools/build_sprite_manifest_v2.py`，不要直接破坏旧 `building_sprite_index.json`，直到新链路切换完毕。

主要函数签名：

```python
def iter_locked_components(catalog: dict, uid_doc: dict, uid_map: dict):
    """只产出 mapping 中可导出的 sprite；排除 kit、自定义和隐藏 try。"""

def decode_all_frames(component: dict, game_root: Path):
    """返回未 trim RGBA、trim RGBA、frame geometry 和源 ALE 哈希。"""

def compute_foot_offset(image, geometry) -> tuple[float, float]:
    """与 desk 当前 stampFootOffset 同语义。"""

def compute_descriptors(rgba) -> dict:
    """alpha、边缘、HSV、Hu moments、ORB；不可只保留 16×16 灰度。"""

def build_equivalence_groups(entries: list[dict]) -> dict:
    """精确 RGBA 组、近似视觉组、同 asset state 视觉组。"""
```

foot 算法初始实现必须忠实复刻当前 desk 行为：

```python
def compute_foot_offset(rgba):
    alpha = np.asarray(rgba.getchannel("A"))
    ys, xs = np.where(alpha >= 2)
    if len(xs) > 1 and len(ys) > 1:
        left, right = xs.min(), xs.max() + 1
        top, bottom = ys.min(), ys.max() + 1
        width, height = right - left, bottom - top
        return (
            left + width / 2.0,
            top + height - max(1.0, height * 0.08),
        )
    return rgba.width / 2.0, rgba.height * 0.8
```

然后增加 JS/Python parity fixture。若未来修改 foot，只能同时修改两端并通过 parity。

### 8.2 state 验证

`tools/build_state_frame_map.py` 必须：

1. 对每个组件遍历 state 0–63。
2. 使用与当前预览相同的解析方式生成 resolved frame。
3. 记录 state 视觉等价组。
4. 从现有真实图纸统计每个素材实际出现过的 state。
5. 对出现过但超出 frameCount 的状态单独报告。
6. 不得擅自把所有合法状态裁成 0/1。

### 8.3 测试

必须新增：

- 所有映射记录满足 `mat == uid*1000+local`。
- alias 永不出现在 canonical export。
- 所有声明 frame 均成功解码，失败进入明确 quarantine 清单。
- 随机 500 帧的 width/height/anchor 与 catalog 一致。
- Python foot 与浏览器 fixture 误差 ≤0.01 px。
- 同 RGBA 哈希一定进入同 exactPixelGroup。
- manifest 构建两次结果稳定，排除时间戳后 hash 相同。

### 8.4 Go / No-Go

Go：

- 100% 可支持素材成功解码，或每个失败素材被明确隔离且产品不再候选它。
- UID、frame、foot 无未知漂移。

No-Go：

- 继续只索引前两帧；
- 仍使用 16×16 指纹作为最终判定；
- foot parity 不通过。

---

## 9. 阶段 P2：Python 权威渲染器与真值 trace

预计 3–5 天。

服务端求解器不能在每个候选上启动浏览器，因此要实现与 `web/building-preview.js` 几何一致的 Pillow/NumPy 渲染器。

### 9.1 `image_to_building/renderer.py`

建议接口：

```python
@dataclass(frozen=True)
class RenderOptions:
    base_no: int
    coordinate_space: Literal["editor", "native"]
    include_mask_grass: bool = True
    include_floor: bool = True
    trace_instances: bool = False

@dataclass
class RenderTrace:
    image: Image.Image
    instance_visible_masks: dict[int, np.ndarray]
    instance_amodal_masks: dict[int, np.ndarray]
    bboxes: dict[int, tuple[int, int, int, int]]
    footpoints: dict[int, tuple[float, float]]
    z_order: list[int]
    paper_to_image: np.ndarray
    ground_anchor: tuple[float, float]

def render_paper(records: list[dict], options: RenderOptions) -> RenderTrace:
    ...
```

实现要求：

1. mask 位置固定。
2. floor 使用实体前顶点与 mask 前顶点贴合。
3. `coordinate_space="editor"` 时复刻 `designMaskX/designMaskY`。
4. 原始记录按输入顺序绘制，禁止先按 `x+2y` 重排真值。
5. 每绘制一件时保存 amodal alpha。
6. 所有件完成后，从后往前计算 visible mask。
7. 输出 paper↔image 仿射变换。
8. 用整数/截断规则与现有 JS 保持一致，不得用“看起来差不多”的 round。

### 9.2 浏览器 parity 测试

准备至少：

- 10 种户型；
- 22 个锁定包；
- 每包至少墙、地面、门窗、屋顶、装饰各 2 件；
- 多 state；
- 叠放、裁切、负 desk 坐标只用于 codec 测试；
- 已验证咖啡馆和围栏 UID 样例。

比较 Python 与 `BuildingPreview.renderPaper`：

1. 画布尺寸一致。
2. ground anchor 误差 ≤1 px。
3. 每件 bbox 误差 ≤1 px。
4. 非透明前景 edge F1 ≥0.995。
5. RGB MAE ≤2（若浏览器和 Pillow 重采样存在微小差异）。
6. 无重采样的原尺寸样例要求 RGBA 完全一致；若做不到，记录确定原因。

### 9.3 Go / No-Go

renderer parity 不通过，禁止生成训练集、禁止做逆向求解。否则后面所有“真值”和残差都是错的。

---

## 10. 阶段 P3：数据集生成与用户素材采集

预计 3–7 天完成工具，真实数据持续收集。

### 10.1 自动合成数据

`tools/generate_building_dataset.py` 接受：

```text
--papers <目录>
--out <数据集目录>
--count <数量>
--seed <整数>
--profiles clean,desk_ui,game_like,jpeg,scaled,cropped
```

生成顺序：

1. 先重放真实图纸。
2. 再对真实图纸做有限变体：
   - 整组平移；
   - 同视觉组替换；
   - 合法 state 变化；
   - 删除少量装饰；
   - 不得随机破坏墙/门窗依附关系。
3. 再生成程序化合法建筑，补长尾素材。
4. 每个场景保存 image、scene.json、visible mask、amodal mask。

首轮 Spike 不需要 30–50 万张。分三档：

- `spike-v1`：5,000 场景，用于 CPU 算法开发。
- `baseline-v1`：50,000 场景，用于阈值和性能压力。
- `ml-v1`：100,000–300,000 场景，只有进入训练阶段才生成。

### 10.2 退化配置

每种退化必须记录参数和随机种子：

- 缩放：0.5–2.0，包含非整数倍率；
- JPEG：质量 35–100；
- WebP；
- gamma：0.8–1.2；
- 亮度、对比度、轻微色温；
- 0–2 px 高斯模糊；
- 浏览器/游戏 UI 遮挡；
- 草地和透明户型幕布；
- 轻度裁切；
- 黑边、安全区；
- 鼠标、选中框、网格；
- 相邻精灵 alpha 混合。

普通截图不是相机照片。不要加入大幅透视扭曲，除非产品明确支持手机拍屏，并且有独立数据桶。

### 10.3 防止数据泄漏

必须按 `paperId/sourceBuildingId` 分组切分：

- train 70%
- validation 15%
- internal test 15%

同一图纸的不同缩放、JPEG、UI 版本只能在同一 split。禁止逐图片随机切分。

真实最终验收集必须另行冻结，永不参与：

- 阈值调节；
- hard negative 挖掘；
- 主动学习；
- 模型训练；
- 人工观察后反复改代码。

---

## 11. 用户需要提供的素材

### 11.1 现在即可提供的最小材料

用户不需要一次准备几千张。CPU Spike 最少提供：

1. 10–30 组“原图纸 + 对应截图”。
2. 每组注明户型号 `baseNo`。
3. 截图尽量保留原始 PNG，不要经过微信压缩。
4. 同一建筑若有设计桌截图和游戏截图，两张都保留。
5. 至少包括：
   - 简单 5–10 件；
   - 普通 10–25 件；
   - 复杂 25–50 件；
   - 两个以上主题包；
   - 有墙、地、门窗、屋顶、装饰；
   - 轻遮挡和明显遮挡；
   - 一张用户已经反馈失败的书店/咖啡馆类建筑。

### 11.2 文件命名

```text
user_pairs/
  case-0001/
    source-desk.png
    source-game.png          # 没有可省略
    paper.txt
    meta.json
  case-0002/
    ...
```

`meta.json`：

```json
{
  "caseId": "case-0001",
  "baseNo": 212,
  "source": ["desk", "game"],
  "clientVersion": "未知可留空",
  "screen": [1920, 1080],
  "browserZoom": 1.0,
  "cropped": false,
  "knownPacks": ["bazaar", "supermarket"],
  "notes": "无遮挡；原始 PNG"
}
```

### 11.3 达到真实游戏可用所需材料

阶段性目标：

- CPU 阈值校准：至少 100–200 对真实图纸/截图。
- 模型首次微调：建议 1,000–2,000 对。
- 稳定覆盖长尾：持续累积到 5,000 对左右。
- 最终封存验收集：至少 1,000 张，不进入开发。

这不是说没有 1,000 张就不能开发。正确顺序是先用自动合成和少量真实对做 Spike，证明方向后再收集。

### 11.4 采集按钮

后续可以增加“贡献训练样本”，但必须：

- 默认关闭；
- 明确说明上传内容；
- 用户主动确认；
- 记录图纸、截图、户型和版本；
- 不收账号密码；
- 支持删除；
- 未经人工确认的预测结果不能自动回灌训练集。

---

## 12. 阶段 P4：无训练 CPU 强基线

预计 1–3 周，是整个项目最重要的止损阶段。

### 12.1 支持范围先收紧

Spike v1 只支持：

- A 类设计桌截图；
- 用户已选择正确户型；
- PNG；
- 主体至少 160 px；
- 缩放范围 0.75–1.5；
- 裁切不超过主体 10%；
- 先限定单主题或用户给定 1–3 个主题包。

不要第一版就全 22 包盲搜、游戏 UI、JPEG、照片一起做。

### 12.2 预处理

`preprocess.py`：

```python
@dataclass
class PreparedImage:
    rgb: np.ndarray
    alpha: np.ndarray
    edge: np.ndarray
    valid_mask: np.ndarray
    ui_mask: np.ndarray
    original_size: tuple[int, int]

def prepare_input(raw: bytes, max_side: int = 1280) -> PreparedImage:
    # 校验格式和尺寸
    # EXIF 方向归一
    # 转 sRGB/RGBA
    # 保留原图，不先粗暴删除绿色
    # 生成边缘图和候选有效区
```

安全要求：

- 只接受 PNG/JPEG/WebP。
- 解码前检查最大 body。
- 解码后限制最大像素数，例如 20 MP。
- 捕获 Pillow decompression bomb。
- 不根据文件扩展名信任 MIME。

### 12.3 户型配准

`registration.py`：

```python
@dataclass
class Registration:
    scale: float
    tx: float
    ty: float
    score: float
    paper_to_image: np.ndarray
    image_to_paper: np.ndarray

def register_known_base(
    source: PreparedImage,
    base_no: int,
    scale_range=(0.5, 2.0),
) -> list[Registration]:
    """返回多个候选，不在低分时强选一个。"""
```

建议算法：

1. 渲染该户型的 mask+floor 模板。
2. 用图像金字塔做多尺度 edge distance / masked NCC。
3. 对 scale 粗扫后在峰值附近细化。
4. 用 RANSAC/局部优化求平移和比例。
5. 暂不支持旋转；若角度偏差 >1°，标记 unsupported。
6. 返回 Top-3 registration，交给场景求解器比较最终残差。

配准门槛：

- clean desk：角点 P95 误差 ≤2 image px；
- game screenshot：P95 ≤5 px；
- 低于置信阈值时要求用户拖动 3 个校准点，不得继续瞎猜。

### 12.4 候选生成

不要把输入先做“最大连通域”，因为断开的招牌和装饰会消失。

候选来源并行组合：

1. alpha/颜色背景差分区域；
2. Canny/Scharr 边缘连通区域；
3. 预计算素材边缘模板的多尺度相关峰值；
4. 地面、墙壁、门窗、屋顶、装饰分类先验；
5. 用户限制的主题包；
6. 已知等距轴和合法纸面范围。

`candidate_generation.py`：

```python
@dataclass
class InstanceProposal:
    bbox: tuple[int, int, int, int]
    category_probs: dict[str, float]
    footpoint_candidates: list[tuple[float, float, float]]
    visible_mask: np.ndarray | None

def generate_proposals(
    source: PreparedImage,
    registration: Registration,
    manifest,
) -> list[InstanceProposal]:
    ...
```

### 12.5 两级素材检索

第一级是廉价召回，只负责把 4000+ 帧缩到每个 proposal 的 50–100 个候选：

- pack filter；
- category filter；
- bbox size ratio；
- alpha area ratio；
- Hu moments；
- HSV 直方图；
- edge orientation；
- ORB descriptors；
- footpoint 合法性。

第二级做精确 masked comparison：

```python
def score_template(
    source_rgb,
    source_valid_mask,
    candidate_rgba,
    placement,
    current_render,
) -> dict:
    return {
        "masked_rgb_mae": ...,
        "masked_ncc": ...,
        "edge_chamfer": ...,
        "alpha_iou": ...,
        "orb_inliers": ...,
        "render_gain": ...,
        "occlusion_robust_score": ...
    }
```

透明素材的 NCC 必须按 alpha 加权，不能先把透明区填黑后调用普通 NCC：

```python
def weighted_ncc(source_rgb, template_rgb, template_alpha, valid_mask):
    # 输入先转 float32；颜色可在 Lab 或线性 RGB 中计算。
    alpha = template_alpha.astype(np.float32) / 255.0
    # 半透明边缘降低权重，避免 ALE 边缘和截图背景混色主导分数。
    weight = ((alpha ** 1.5) * valid_mask.astype(np.float32))[..., None]
    denom = float(weight.sum())
    if denom < 16.0:
        return None
    mean_source = (source_rgb * weight).sum(axis=(0, 1)) / denom
    mean_template = (template_rgb * weight).sum(axis=(0, 1)) / denom
    source_centered = source_rgb - mean_source
    template_centered = template_rgb - mean_template
    numerator = (weight * source_centered * template_centered).sum()
    source_energy = (weight * source_centered**2).sum()
    template_energy = (weight * template_centered**2).sum()
    return float(numerator / np.sqrt(source_energy * template_energy + 1e-8))
```

必须测试：相同模板得分接近 1；透明边缘颜色变化不应主导结果；空 mask 返回 `None`；大面积纯色墙不能仅靠 NCC 获得唯一高置信度。

总分不能只靠一个手写权重。初期可以：

```text
score =
  0.25 * masked_ncc
  + 0.20 * edge_score
  + 0.15 * alpha_iou
  + 0.10 * hsv_similarity
  + 0.30 * normalized_render_gain
  - illegal_geometry_penalty
```

权重必须在 development set 上拟合或网格搜索，并保存版本；不得在最终 test 上调。

### 12.6 renderer-in-the-loop 求解

核心不是“每个区域独立选第一名”，而是选择组合后重新渲染整图。

建议数据结构：

```python
@dataclass(frozen=True)
class SceneCandidate:
    records: tuple[Record, ...]
    rendered: np.ndarray
    explained_mask: np.ndarray
    loss: float
    unresolved: tuple[Region, ...]

def solve_scene(
    source,
    registrations,
    proposals,
    candidate_sets,
    renderer,
    beam_width=8,
    max_records=80,
) -> list[SceneCandidate]:
    ...
```

伪代码：

```python
beam = [empty_scene_for_each_registration]

for proposal in proposals_sorted_by_confidence_and_visibility:
    expanded = []
    for scene in beam:
        expanded.append(scene)  # 允许拒绝该 proposal
        for candidate in top_k[proposal][:10]:
            for placement in refine_xy_state(candidate, proposal, radius=4):
                next_scene = scene.add(candidate, placement)
                next_scene.render_incrementally()
                gain = loss(scene) - loss(next_scene)
                if gain > MIN_RENDER_GAIN and constraints_ok(next_scene):
                    expanded.append(next_scene)
    beam = deduplicate_and_keep_best(expanded, width=8)

beam = coordinate_descent_refine(beam, xy_radius=3, passes=2)
return top_3_with_uncertainty(beam)
```

损失至少包括：

- 有效前景 RGB/颜色残差；
- 边缘距离；
- alpha/前景覆盖；
- 未解释前景惩罚；
- 多解释背景惩罚；
- 等距墙轴约束；
- 门窗依附墙约束；
- 屋顶与墙体关系；
- 越界和非法 UID/state；
- 复杂度惩罚，防止用大量小件刷低像素误差。

完全遮挡的记录不会降低残差，求解器不得凭空添加。

### 12.7 置信度和拒答

置信度必须综合：

- Top-1 与 Top-2 分差；
- 加入该件产生的 render gain；
- 配准置信度；
- 可见面积；
- 多种退化下候选稳定性；
- 场景 Top-1 与 Top-2 总损失差。

在验证集上做可靠性校准。第一版可用 isotonic regression 或 Platt scaling。

规则：

- 置信度 ≥自动接受阈值：写入候选 spec，但仍可撤销。
- 中等置信度：显示 Top-5，等待确认。
- 低置信度：显示未识别区域，不生成记录。
- 禁止 `entries[0]` 或任何“保证有输出”的兜底。

### 12.8 CPU 性能预算

线上 8 vCPU/16GB：

- worker 并发：1，压测后最多 2。
- 输入长边：默认 960，复杂图最高 1280。
- OpenCV 内部线程：4–6。
- BLAS 线程：1，避免线程过量。
- 模板描述符常驻内存目标 <1 GB。
- 单张 clean desk 目标：P50 ≤5 秒，P95 ≤15 秒。
- game screenshot 目标：P50 ≤10 秒，P95 ≤30 秒。
- job 超时：初期 60 秒；超时返回可解释错误，不阻塞 HTTP。

必须写 benchmark，不能只凭估计。

### 12.9 CPU Spike 门槛

在至少 50 张从未用于调参的 A 类配对图上：

- 户型配准成功率 ≥98%；
- 可观察实例检测 F1 ≥85%；
- 干净单素材查询 Top-1 ≥90%、Top-5 ≥98%；
- exact/visual-equivalent 素材 Top-5 ≥90%；
- Top-1 ≥65%；
- 高置信自动接受记录 precision ≥95%，且 coverage ≥20%；
- 已匹配实例 paper 坐标 P95 ≤4；
- catastrophic <5%；
- P95 推理 ≤30 秒。

若 Top-5 <90%，先修数据、frame/foot/配准，禁止直接训练大模型掩盖底层错误。

若 Top-5 ≥90% 但 Top-1 <85%，说明候选库和几何基本正确，进入训练排序阶段有价值。

---

## 13. 阶段 P5：是否训练的决策

只有满足以下全部条件才训练：

1. renderer parity 已过。
2. manifest 全帧和 foot parity 已过。
3. CPU baseline 的 Top-5 ≥90%。
4. 有至少 200 组真实配对图可用于验证/微调。
5. 错误主要是候选排序、局部遮挡或 proposal 召回，而不是坐标系错误。

如果 CPU baseline 已经满足产品工作流，则可不训练。训练不是项目完成的必需仪式。

---

## 14. 阶段 P6：可选小模型训练

训练只在本机 RTX 3060 Ti 上进行，模型导出 ONNX 后由无显卡服务器推理。

### 14.1 不训练 4000 类直接检测器

推荐拆成：

1. 类别无关实例/脚点检测器：
   - 5 个大类：地面、墙壁、门窗、屋顶、装饰；
   - bbox；
   - 一个 footpoint keypoint；
   - 可选粗 mask。
2. 素材检索 embedding：
   - 输入实例 crop 和上下文；
   - 输出 128/256 维归一化向量；
   - 与离线图库 embedding 检索 Top-32。
3. candidate reranker：
   - 比较 source crop、候选 RGBA、当前重渲染上下文；
   - 输出候选概率。
4. 最终仍交给 scene solver，不让模型直接输出最终图纸。

### 14.2 依赖策略

新建：

```text
requirements-cv.txt
requirements-ml.txt
```

规则：

- 使用包管理器安装当时最新稳定版，然后生成锁文件/精确版本清单。
- 不得凭空写不存在的版本号。
- PyTorch/CUDA 版本按本机驱动兼容矩阵选择。
- 线上不得安装 `requirements-ml.txt`。
- 训练产物记录 Python、PyTorch、CUDA、驱动和 git commit。

### 14.3 检测器安全起始配置

可选用当前稳定、支持 keypoint/pose 和 ONNX 导出的小型模型。不要锁死某个未来可能不存在的商品名；实现时选择最小可用 pose checkpoint，并记录确切版本。

RTX 3060 Ti 8GB 起始值：

```yaml
image_size: 640
batch_size: 4
gradient_accumulation: 4
mixed_precision: fp16
epochs: 100
early_stopping_patience: 15
optimizer: AdamW
learning_rate: 0.0003
weight_decay: 0.01
warmup_epochs: 3
num_workers: 4
classes: 5
keypoints_per_instance: 1
```

OOM 时按顺序处理：

1. batch 4 -> 2；
2. gradient accumulation 4 -> 8；
3. image size 640 -> 512；
4. 不要直接换大显卡结论。

训练日志必须记录显存峰值和每轮时间。

### 14.4 检索器安全起始配置

建议 ResNet-18 或同等轻量 backbone，输出 256 维 L2-normalized embedding。

```yaml
crop_size: 192
batch_size: 32
gradient_accumulation: 4
mixed_precision: fp16
epochs: 50
optimizer: AdamW
learning_rate: 0.0003
weight_decay: 0.0001
loss:
  supervised_contrastive: 1.0
  triplet_hard: 0.5
  category_aux: 0.2
temperature: 0.07
margin: 0.2
```

每个 batch 必须包含：

- 同一素材不同退化的正样本；
- 同 pack 同 category 的 hard negative；
- 相邻 state；
- 视觉近似组；
- 大小/轮廓相似但 ID 不同的素材。

像素等价组不能强迫模型区分。先预测 `visual equivalence group`，再由 pack、场景上下文和用户确认确定 canonical mat。

### 14.5 合成与真实数据比例

训练初期：

- 70% 合成；
- 30% 真实配对。

后期微调：

- 30% 合成 hard cases；
- 70% 真实配对。

不得让大量简单合成样本淹没真实域。每轮按 pack、category、visibility 做重采样。

### 14.6 可见度分桶

- `visible ≥70%`：高可见。
- `30%≤visible<70%`：中遮挡。
- `visible<30%`：低可见，只做候选或拒答。
- 完全遮挡：不评估单截图恢复。

### 14.7 模型门槛

在未见过布局的真实 validation 上：

- proposal/footpoint 检测 F1 ≥95%；
- footpoint image P95 ≤5 px；
- 高可见素材 Top-1 ≥90%、Top-5 ≥98%；
- 中遮挡 Top-1 ≥80%、Top-5 ≥93%；
- 模型+solver 比 CPU baseline 的实例 F1 至少提高 5 个百分点；
- 任一核心 pack/category 不得比总体低超过 8 个百分点。

连续两轮补充真实数据后仍不达标：

- 停止追求更大模型；
- 转为 Top-K 人机协同产品；
- 不得用训练集成绩宣传。

### 14.8 ONNX 导出和线上 CPU

导出：

- opset 取当前 onnxruntime 支持的稳定值；
- dynamic batch 可有，空间尺寸尽量固定；
- FP32 baseline；
- INT8 static quantization 使用独立 calibration set；
- 量化后关键指标下降不得超过 1.5 个百分点。

线上：

- `onnxruntime` CPUExecutionProvider；
- intra-op threads 4–6；
- inter-op threads 1；
- worker 并发 1；
- 模型预热；
- gallery embedding 常驻内存；
- 输入尺寸 640；
- 输出交给 CPU scene solver。

---

## 15. 阶段 P7：异步 Job API

现有 `server.py` 是 `ThreadingHTTPServer`。不得在 request handler 里直接运行 5–30 秒视觉算法。

### 15.1 API

#### 创建

```http
POST /api/image-building/jobs
Content-Type: multipart/form-data

image=<binary>
baseNo=212
inputType=desk|game|reference
packScope=bazaar,supermarket
algorithm=cpu-v1|hybrid-v1
```

响应：

```json
{"jobId":"…","status":"queued"}
```

#### 状态/结果

```http
GET /api/image-building/jobs/{jobId}
```

状态：

- queued
- running
- needs_review
- succeeded
- failed
- cancelled
- expired

#### 取消

```http
DELETE /api/image-building/jobs/{jobId}
```

### 15.2 用户隔离与安全

1. job 绑定 `_current_user()`。
2. 用户不能读取他人的 job ID。
3. job ID 使用不可预测随机 token。
4. 每用户最多 2 个 queued/running。
5. 全局并发初始为 1。
6. 原图默认 24 小时删除。
7. 结果 7 天删除，或按现有保存策略调整。
8. 路径全部由服务端生成，禁止用户提交磁盘路径。
9. 返回错误不泄露绝对路径和堆栈。
10. 所有写盘采用临时文件 + 原子 rename。

### 15.3 Job 存储

首版可用 SQLite 或每 job JSON + 原子更新。若用 JSON：

```text
data/image_to_building/jobs/<user-hash>/<job-id>/
  request.json
  source.bin
  state.json
  result.json
  render.webp
  diff.webp
```

必须有进程重启恢复：

- running 状态重启后改为 queued 或 failed-retryable；
- 禁止永远卡在 running。

### 15.4 worker

`worker/image_building_worker.py`：

```python
def main():
    manifest = load_manifest_once()
    descriptors = load_descriptor_index_once()
    models = load_optional_models_once()
    while True:
        job = claim_next_job_atomically()
        if not job:
            sleep(0.25)
            continue
        try:
            update(job, "running", progress=0.02)
            result = service.convert(job, progress_callback=...)
            save_result_atomically(job, result)
        except Cancelled:
            update(job, "cancelled")
        except Exception as exc:
            update(job, "failed", public_error=safe_message(exc))
```

生产建议独立 systemd service/container。即使 worker 崩溃，主设计桌仍能服务。

### 15.5 资源限制

起始配置：

```text
OMP_NUM_THREADS=6
OPENBLAS_NUM_THREADS=1
MKL_NUM_THREADS=1
MANOR_IMAGE_WORKERS=1
MANOR_IMAGE_JOB_TIMEOUT=60
```

worker 启动后显式调用 `cv2.setNumThreads(6)`；OpenCV 没有可靠的通用环境变量可代替这一步。通过压测再调，不得默认并发 8。

---

## 16. 阶段 P8：前端纠错工作台

前端目标不是隐藏不确定性，而是让用户快速修正。

### 16.1 四步流程

1. 输入与校准
   - 选择输入类型；
   - 选择户型；
   - 选择主题范围；
   - 自动配准失败时拖 3 个校准点。
2. 实例检查
   - 原图上显示检测框、脚点和置信度；
   - 可添加、删除、合并、拆分区域。
3. 素材与 state
   - 点击实例显示 Top-5 真实缩略图；
   - 切换 state；
   - 支持整段墙统一替换；
   - “未识别”保持为空。
4. 差异与应用
   - 原图、重渲染、差异热图；
   - 显示未解释区域；
   - 通过硬质量门后才允许应用。

### 16.2 Apply 硬门

以下任一情况禁用“铺到当前户型”：

- 无记录；
- 只有地面且输入明显有其它结构；
- 非法 UID/local/state；
- alias UID 将被导出；
- `mat=0`；
- 坐标越界；
- 配准置信度不足；
- 所有候选平均置信度过低；
- catastrophic flag；
- 预览渲染 unresolved；
- 用户勾选替换当前建筑，但新结果尚未达到最小有效记录数。

### 16.3 写入事务

Apply 必须：

1. 先完整 validate；
2. 在内存构造新 records；
3. 确认每条 component 都能解析；
4. 只 push 一次 history；
5. 替换模式下先保留旧 records 的副本；
6. 全部成功后一次性替换；
7. 任一失败恢复旧 records；
8. 预览和 apply 使用同一 `x/y`，不得二次 foot 换算导致偏移。

建议新结果直接使用标准 record 左上角坐标。`footX/footY` 只做 UI 辅助，不要在 apply 时再次通过 `appendSpriteStamp` 重算一遍；若必须复用 `appendSpriteStamp`，要提供“输入已经是 top-left”模式并测试等价。

### 16.4 移动端验收

必须实测：

- 360×640；
- 390×844；
- 844×390；
- 768×1024；
- 桌面。

检查：

- Top-5 缩略图可横向滚动；
- 拖脚点不滚动页面；
- 双指操作不误改；
- bottom sheet 不遮住确认按钮；
- 输入字号 ≥16 px；
- safe-area；
- 焦点陷阱和 Escape；
- 横竖屏切换状态不丢。

---

## 17. 评测实现

### 17.1 可观察实例

主评测只纳入：

- visible fraction ≥25%；
- 有效可见面积 ≥64 px；
- 未被截图裁掉到无法定位；
- 对应素材存在于支持 manifest。

其余单列：

- low visibility；
- fully occluded；
- unsupported asset；
- unregistered/cropped。

### 17.2 实例匹配

使用 Hungarian matching。预测与真值成本：

```text
若 canonicalMat 或 visual group 不匹配：大惩罚
若 state visual group 不匹配：附加惩罚
坐标成本：footpoint 的 paper 欧氏距离
类别不匹配：附加惩罚
```

严格 TP：

- canonical mat 完全相同；
- state 完全相同；
- paper footpoint 距离 ≤4。

视觉等价 TP：

- exactPixelGroup/nearVisualGroup 匹配；
- stateVisualGroup 匹配；
- paper footpoint 距离 ≤4。

两套指标同时报告。

### 17.3 指标

```text
precision = TP / (TP + FP)
recall = TP / (TP + FN)
F1 = 2PR / (P + R)
Top-K recall = 正确等价组出现在前 K 的真值实例数 / 可观察真值实例数
catastrophic rate = catastrophic scenes / eligible scenes
workflow success = 修正预算内通过整图验收的场景数 / eligible scenes
coverage(t) = confidence≥t 且被自动接受的场景数 / eligible scenes
risk(t) = 自动接受场景中存在错误的场景数 / 自动接受场景数
```

每次评测必须输出 risk-coverage 曲线。选择自动接受阈值时先约束 precision/risk，再追求 coverage；不得通过强制输出所有截图来提高 coverage。

整图成功条件：

- visual-equivalent instance F1 ≥95%；
- 无非法记录；
- round-trip 通过；
- 户型未改变；
- 无 catastrophic；
- 人工修正未超过预算。

报告 95% Wilson 置信区间。最终“95% 工作流成功率”要求 95% 置信下界也 ≥95%，因此测试集不能太小。

### 17.4 分桶报告

至少按以下维度：

- desk / game；
- PNG / JPEG；
- 5–10 / 11–25 / 26–50 / >50 件；
- 高/中/低遮挡；
- 每个 pack；
- 每个 category；
- 缩放区间；
- 单包/混包；
- 手机/桌面截图；
- 自动配准/人工校准。

总体过线但核心桶低于 90%，不得发布 95% 文案。

---

## 18. 测试清单

### 18.1 单元测试

- UID 映射和 alias；
- 全帧解码；
- foot parity；
- state mapping；
- floor/mask 顶点；
- alpha composite；
- visible/amodal mask；
- paper↔image 变换；
- descriptor 稳定性；
- masked NCC；
- NMS；
- beam 去重；
- confidence calibration；
- Hungarian metrics；
- job 状态机；
- 用户隔离；
- 图片炸弹和错误 MIME。

### 18.2 集成测试

- paper -> Python render -> scene truth；
- paper -> browser render 与 Python parity；
- synthetic image -> CPU solver -> prediction；
- prediction -> codec export -> import；
- API create -> worker -> result -> cancel/expire；
- 前端选择候选 -> apply -> undo；
- server 重启后 job 恢复；
- worker 崩溃不影响 `/api/health`。

### 18.3 回归测试

永久保留：

- 咖啡馆 UID 样例；
- 围栏 `8101`；
- 书店失败样例；
- 巨大地基失败；
- 墙/装饰飞角落；
- preview/apply foot 偏移；
- alias 误导出；
- 纯绿色素材被背景删除；
- 断开装饰被最大连通域删除。

### 18.4 计划中的命令契约

Grok 实现这些 CLI，并确保 `--help` 清楚：

```powershell
python tools/build_sprite_manifest_v2.py --verify --out data/image_to_building/manifests/v2
python tools/build_state_frame_map.py --manifest data/image_to_building/manifests/v2/manifest.jsonl
python tools/verify_renderer_parity.py --cases tests/fixtures/image_to_building/renderer
python tools/generate_building_dataset.py --papers data/papers --count 5000 --seed 20260902 --out datasets/spike-v1
python tools/evaluate_image_to_building.py --dataset datasets/gold-desk-v1 --algorithm cpu-v1 --report reports/cpu-v1.json
python tools/benchmark_image_to_building.py --dataset datasets/benchmark-v1 --workers 1
python -m pytest
node --test tests/building-image-convert.test.js tests/building-interactions.test.js
```

训练阶段才增加：

```powershell
python ml/train_detector.py --config configs/detector-v1.yaml
python ml/train_retriever.py --config configs/retriever-v1.yaml
python ml/export_onnx.py --run runs/detector-v1
python ml/calibrate_confidence.py --predictions reports/validation-predictions.jsonl
```

---

## 19. 分阶段验收与止损

### Gate 0：失败可复现

通过：

- 旧失败样本和 baseline report 已冻结。

否则：

- 不进入新算法。

### Gate 1：素材真值可信

通过：

- 全帧 manifest；
- UID 100% 合法；
- foot parity；
- state 映射可追踪。

否则：

- 修数据，不写 matcher。

### Gate 2：渲染器可信

通过：

- Python/浏览器 parity 达标；
- 图纸 round-trip 100%。

否则：

- 禁止生成训练集。

### Gate 3：CPU Spike 有信号

通过：

- A 类真实 Top-5 ≥90%；
- 坐标 P95 ≤4；
- catastrophic <5%。

否则：

- 检查配准、frame、foot、候选库；
- 两轮仍不达标，停止“自动还原”，只保留人工结构辅助。

### Gate 4：CPU 产品基线

通过：

- Top-5 ≥95%；
- 自动实例 F1 ≥75%；
- 中位人工修改 ≤15%；
- P95 ≤30 秒；
- catastrophic <2%。

否则：

- 不接生产入口。

### Gate 5：模型值得上线

通过：

- 相对 CPU F1 提升 ≥5 点；
- ONNX CPU 性能可接受；
- INT8 下降 ≤1.5 点。

否则：

- 保持 CPU + Top-K，不为模型而模型。

### Gate 6：工作流 95%

通过：

- 冻结真实验收集；
- 95% 置信下界 ≥95%；
- 中位修正 ≤2 分钟；
- P95 修正 ≤5 分钟；
- UID/户型/round-trip 100%；
- catastrophic <1%。

否则：

- 保持“实验性/辅助还原”文案；
- 不声称 95%。

---

## 20. 部署计划

### 20.1 服务拆分

至少两个进程：

1. `manor-desk`：现有 HTTP。
2. `manor-image-worker`：CPU 转换。

可选第三个：

3. 反向代理 Caddy/Nginx。

### 20.2 发布包

每次发布固定：

```json
{
  "algorithmVersion": "cpu-v1.3.0",
  "modelVersion": null,
  "uidMappingSha256": "…",
  "manifestSha256": "…",
  "rendererVersion": "1.1.0",
  "stateMapSha256": "…",
  "goldReportSha256": "…",
  "gitCommit": "…"
}
```

启动时校验 hash。不匹配则 worker 拒绝接 job，主站仍正常。

### 20.3 灰度

1. 本地 only。
2. 线上管理员账号。
3. 10% 用户。
4. 50%。
5. 默认开启。

每级至少观察：

- job 成功率；
- P50/P95 耗时；
- 内存；
- worker 崩溃；
- 用户接受/撤销/替换数；
- catastrophic；
- API 延迟是否受影响。

### 20.4 回滚

- 保留上一版 manifest、算法包、ONNX 和配置；
- feature flag 一键回旧入口/关闭入口；
- job result 带版本，旧结果仍能打开；
- 数据 schema 只能向后兼容读取；
- 不通过手工改数据库完成回滚。

---

## 21. Grok 的执行纪律

以下内容原样作为 Grok 的系统级项目约束。

### 21.1 每个阶段开始前

1. 读取本文件。
2. 读取三个 `.cursor/rules/*.mdc`。
3. 读取相关现有代码，不凭摘要猜实现。
4. 执行 `git status`，不得覆盖、删除或格式化用户已有改动。
5. 列出本阶段目标、非目标、计划修改文件、验收命令。
6. 只实施一个 Gate。

### 21.2 每个阶段完成时

必须提交给用户：

1. 修改文件清单。
2. 算法和数据契约变化。
3. 实际运行的命令及结果。
4. 指标报告路径。
5. 尚未满足的 Gate。
6. 已知失败样本。
7. 是否建议继续。

没有指标报告不得说“完成”。

### 21.3 禁止行为

- 禁止调整锁定 UID 映射。
- 禁止改户型 mask/地基几何来迁就识别结果。
- 禁止跨包借 `框架`。
- 禁止输出 `mat=0`。
- 禁止低置信强选第一件。
- 禁止用默认 L 墙、默认门窗、默认 2×2 地面冒充识别。
- 禁止只用彩色矩形合成测试证明真实截图有效。
- 禁止把训练样本放进验收集。
- 禁止只报告平均数。
- 禁止把 Top-5 命中写成 Top-1。
- 禁止把人工修正后准确率写成自动准确率。
- 禁止在无 GPU 线上安装训练环境。
- 禁止同步阻塞 HTTP request 做推理。
- 禁止推理失败后清空用户当前建筑。
- 禁止未经用户要求部署。
- 禁止顺手重构无关代码。
- 禁止在未过前一 Gate 时提前做漂亮 UI。

---

## 22. 可直接复制给 Grok 的总提示词

```text
你正在仓库 D:\game\浪漫庄园-外部设计桌 中实现“图片转建筑”。

先完整阅读根目录 IMAGE_TO_BUILDING_GROK_EXECUTION_PLAN.md，以及：
.cursor/rules/building-pack-uids-locked.mdc
.cursor/rules/building-base-frame-locked.mdc
.cursor/rules/mobile-workspace-required.mdc

严格遵循计划的分阶段 Gate。一次只做用户指定的一个阶段，不得提前实现后续阶段。

这是闭集逆向渲染系统，不是根据 bbox 和均色猜 L 墙。禁止默认地基、默认墙、entries[0] 兜底和任何低置信强制输出。低置信必须返回 unresolved/Top-K。

线上硬件是 8 vCPU、16GB、无 GPU。P0-P4 只能使用 CPU 传统视觉和 renderer-in-the-loop；训练只允许在本机 RTX 3060 Ti 8GB 上进行，且只有 Gate 3 通过、正确素材 Top-5 已有信号后才能开始。生产环境不得安装 PyTorch/CUDA。

UID 和户型规则是硬约束：
- mat = uid*1000+local；
- data/building_pack_uids.json mapping 不可改；
- aliases 只解码不导出；
- frameBorrow=false；
- 不跨包借框；
- 不生成 mat=0；
- 不移动、缩放、重建 mask；
- baseimg 按 floorSnugInMask 贴合；
- 图纸 x/y 是精灵左上角，foot 只用于中间定位；
- state 不得未经验证等同 frame；
- 记录顺序是真实绘制顺序，x+2y 只是先验。

开始工作前：
1. git status，保护所有已有改动；
2. 阅读计划指定的现有文件；
3. 向用户报告本 Gate 的目标、非目标、修改文件和验收命令；
4. 若需求与硬约束冲突，停止并指出冲突，不得自行折中。

完成工作后：
1. 跑计划要求的单元、集成和回归测试；
2. 生成机器可读指标报告；
3. 报告实际指标，不能用“看起来不错”；
4. 未达到 Gate 就明确 No-Go，不能部署、不能宣传成功；
5. 不要提交或部署，除非用户明确要求。

当前只执行：[在这里填写 P0 / P1 / P2 / P3 / P4 / P5 / P6 / P7 / P8]
```

---

## 23. 推荐的实际执行顺序

### 第一轮：证明底层可信

1. P0 冻结失败。
2. P1 全帧 manifest + foot/state。
3. P2 Python renderer parity。

这三步不做识别 UI，也不训练。

### 第二轮：3–10 天止损 Spike

1. 用户提供 10–30 组配对样本。
2. 自动生成 5,000 合成样本。
3. 完成已知户型配准。
4. 只支持单包 clean desk PNG。
5. 做两级模板检索和简单 scene solver。
6. 用 50 张未调参图片验收 Top-5。

Top-5 不到 90%，停止加功能，回查 renderer/foot/frame/registration。

### 第三轮：做成可用辅助工具

1. 扩展到游戏截图和多包。
2. 异步 worker。
3. Top-5 纠错 UI。
4. Apply 事务和硬质量门。
5. 收集真实 hard cases。

### 第四轮：可选训练

只有 CPU 候选召回已经高、排序仍是主要瓶颈才训练。

### 第五轮：盲测和灰度

最终冻结 1,000 张真实验收集，以工作流指标决定是否可以写“95% 可用”。

---

## 24. 最终 Definition of Done

只有同时满足以下条件才算项目最终完成：

1. 全帧素材库可重建、可校验、版本化。
2. UID 映射和户型规则零违规。
3. Python renderer 与浏览器 renderer parity 达标。
4. 输入图能可靠配准；失败时可人工校准或拒答。
5. 每个实例有 Top-K、分数、证据和 unresolved 路径。
6. 低置信不强填。
7. 场景经过重渲染残差求解，不是独立逐件盲选。
8. preview 与 apply 坐标完全一致。
9. 图纸 codec round-trip 100%。
10. 无显卡线上 P95 性能和并发达到预算。
11. HTTP 服务不被推理阻塞。
12. 手机、平板和桌面全部可纠错。
13. 冻结真实验收集和分桶指标公开可复跑。
14. 工作流成功率的 95% 置信下界达到 95%。
15. catastrophic <1%。
16. 回滚经过演练。

若只能达到其中前 13 项，但工作流 95% 未过，产品名称应保持“实验性辅助还原”，不能称为“95% 自动还原”。

