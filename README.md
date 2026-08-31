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

## 公网部署（手机随时用）

本机双击 `启动.bat` 仍然只监听 `127.0.0.1`。要挂到服务器给手机访问，需要一台有公网 IP 的 Linux（阿里云 / 腾讯云轻量即可），并带上完整贴图目录 `vendor/game`。

1. 把整个工程拷到服务器（含 `vendor/game` 里的 jpg/ale，不要只传代码）。
2. 复制 `deploy/.env.example` 为仓库根目录的 `.env`，改掉用户名和密码。
3. 有域名时把 `.env` 里的 `MANOR_SITE` 改成 `https://你的域名`（域名 A 记录指向服务器），防火墙放行 80、443。
4. 在工程目录执行：

```bash
cp deploy/.env.example .env
# 编辑 .env 里的 MANOR_USER / MANOR_PASSWORD / MANOR_SITE
docker compose up -d --build
```

浏览器打开域名（或 `http://服务器IP:8095/`）。第一次会弹出账号密码，之后手机浏览器可以记住。地形和建筑草稿会写到服务器 `data/saves/`，换手机也能接着做。导出的游戏图纸 txt 仍由浏览器下载，不代替游戏内存档。

没有 Docker 时：

```bash
export MANOR_HOST=0.0.0.0 MANOR_PORT=8765 MANOR_USER=manor MANOR_PASSWORD='很长的密码' MANOR_NO_BROWSER=1
python3 server.py
```

前面再挂 Caddy / Nginx 做 HTTPS。监听非本机地址时必须设密码，否则进程会拒绝启动。

不要把游戏贴图目录公开成无密码网站。这是给你和朋友用的私人设计桌，不是给全网随便逛的。

## 操作

- 左键铺地形 / 放建筑
- Shift+左键擦
- 右键拖动画布
- 滚轮缩放
- 手机和平板：底栏切换素材、图层、移动和项目；面板以底部抽屉或侧栏打开
- 单指执行当前工具；双指拖动画布并缩放，不会落下地块或移动建筑
- 横竖屏旋转后画布会重新适配；弹出键盘时输入框会滚到可见区域
- **更换地形**：草地底板 / 沙地底板（写入图纸 `mapflag`）
- 地形种类来自 `mapdata.tab`，贴图来自 `00changgui.ini` / `yewai.ini` 的 jpg/gif
- 种类字符 = `00changgui.ini` 里 `addkind` 的序号（64 进制 1 位）。**没有对照的字符会标红，不会被改写成别的地块。**

## 注意

游戏不能吃一份合体文件。这里一起画，导出仍是两个 txt。

## 移动端开发约定

两套设计桌共用 `web/mobile-workspace.css` 和 `web/mobile-workspace.js`。新增功能必须在
360×640、390×844、844×390、768×1024 和桌面尺寸回归；触摸目标至少 44×44，不能依赖
hover 或键盘快捷键，画布手势统一使用 Pointer Events。移动端只能改变工作区布局和视口，
不能改变游戏坐标、图纸编码、建筑 UID 映射或锁定的户型渲染算法。
