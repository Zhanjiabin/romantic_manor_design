# 浪漫庄园 · 外部设计桌

独立工程，不改写游戏本体。同一画布铺地形、叠建筑，分别导出游戏能导入的 GBK 图纸。

- 地形：`模板=(种类,x,y,...);size=...;mapflag=...`
- 建筑：`V1;` 九字符一条（庄园放置；若打开的是建筑桌素材模板则按桌格式回写）

仓库已带运行所需贴图和表（`vendor/game`）。其它电脑 `git clone` 后装好 Python 即可用，不必再解包游戏。

## 启动

需要 Python 3。

```bat
python -m pip install -r requirements.txt
python server.py
```

Windows 也可双击 `启动.bat`。浏览器打开 http://127.0.0.1:8765/

默认读本仓库的 `vendor/game`。若要改用本机解包的游戏目录，复制 `config.example.json` 为 `config.json`，填写 `gameRoot`，或设环境变量 `MANOR_GAME_ROOT`。

## 操作

- 左键铺地形 / 放建筑
- Shift+左键擦
- 右键拖动画布
- 滚轮缩放
- **更换地形**：草地底板 / 沙地底板（写入图纸 `mapflag`）
- 地形种类来自 `mapdata.tab`，贴图来自 `00changgui.ini` / `yewai.ini` 的 jpg/gif
- 种类字符 = `00changgui.ini` 里 `addkind` 的序号（64 进制 1 位）。**没有对照的字符会标红，不会被改写成别的地块。**

## 注意

游戏不能吃一份合体文件。这里一起画，导出仍是两个 txt。
