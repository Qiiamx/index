# Index

把 HTTP 目录片源和 RSS 订阅整理成自己的追番库。PC 本地网页服务，BT 下载交给 qBittorrent，播放交给本机播放器。

## 需要什么

- Windows + Node.js 24
- qBittorrent（启用 Web UI；默认 http://127.0.0.1:8080）
- 一个本机播放器（mpv / VLC / PotPlayer / MPC 等，任意都行）

## 安装与启动

### 日常使用（推荐）

双击根目录的 **`Index.vbs`**：

- 不会打开命令行窗口；
- 右下角出现托盘图标，Node 服务在后台运行；
- 第一次启动会自动安装依赖并构建（隐藏在后台，日志在 `data/logs/`）；
- 双击托盘图标打开 http://127.0.0.1:8090 ；
- 右键菜单可以打开数据/日志目录、重启服务、开关机启动、退出。

托盘图标灰色表示服务已停止，蓝色表示运行中。

### 开发/调试

```powershell
npm install --registry=https://registry.npmmirror.com
npm run dev
```

或者：

```powershell
npm run build
npm start
```

`start.ps1` 会打开命令行和浏览器，只用于开发；日常请用 `Index.vbs`。

如果 npm 下载慢，使用上面的国内镜像。

### 开机启动

右键托盘图标 → 勾选“开机启动”。也可以手动执行：

```powershell
.\tools\install-startup.ps1
.\tools\remove-startup.ps1
```

## 第一次使用

1. 打开“设置”，确认 qBittorrent 地址；无密码就留空账号密码，点“测试当前连接”。
2. 填播放器路径，例如 `C:\Program Files\mpv\mpv.exe`；留空则用 Windows 默认打开方式。
3. 到“源”添加 HTTP 目录或 RSS 订阅。
4. 为片源添加规则：目录层级一行一级，最后一行是文件正则；改名只影响显示名。
5. 到“追番”新建文件夹和标签，把规则目标指向文件夹。
6. RSS 源会生成待下载任务；在“下载”里点“开始待下载”，或打开设置里的自动下载。

## BT 与下载目录

- 任务通过 qBittorrent Web API 添加，默认 `autoTMM=true`，不指定保存目录。
- 保存位置、分类目录、做种倍率/时长、Tracker、DHT、BT 代理都在 qBittorrent 里配置。
- 任务带 `index` 和 `index-<任务ID>` 标签；程序只管理自己添加的任务。
- 任务完成后，程序读取 qBittorrent 的文件列表，把视频映射到逻辑文件夹；不会移动或改名物理文件。
- 只索引已下载完成的文件；不播放下载中的文件。
- 删除任务时可选择是否同时删除文件。

## 播放

- 点击“播放”会在本机打开播放器，支持本地 BT 文件和 HTTP 目录源的远程 URL。
- 程序记录“全局上次观看”和“每个文件夹上次观看”，用于首页/文件夹页的“继续播放”。
- 文件内的播放进度由播放器自己管理（mpv/VLC/PotPlayer 都有续播能力）。

## 数据

- `data/index.db`：SQLite 数据库（文件夹、标签、源、规则、任务、索引、观看记录、设置）。
- `config.json`：可选，服务端口和数据目录；默认 `8090` / `data`。
- 两者都不会提交到 Git。

## 代理

- RSS/HTTP 目录抓取可以在设置里填一个 http/https 代理，默认关闭。
- BT 代理不在这里配置，请直接在 qBittorrent 里设置。

## 已知限制

- 只支持本机访问，没有登录和 HTTPS。
- 只索引 qBittorrent 中带 `index` 标签的任务；手动添加的任务不会自动进库。
- 下载中的文件不能播放；需要等任务完成。
- HTTP 目录源的播放依赖播放器自己处理 URL；需要 Cookie/Referer 的站点暂时不支持。
- 网页 UI 不内嵌视频播放器。
- 项目在 Windows 上开发和验证，其他平台未测试。

## 常见问题

**qBittorrent 显示未连接**

确认 qBittorrent 正在运行，Web UI 已启用，地址/端口正确。无密码时需要允许 localhost 免登录，或在设置里填用户名密码。

**RSS 刷新没有新任务**

先确认源已启用、地址可访问；如果种子链接在自定义字段里，填“种子链接正则”。已存在的条目不会重复创建。

**规则没有匹配到文件**

目录层级必须从片源根目录开始逐级匹配，最后一行才是文件；BT 多文件种子的路径包含种子根目录。

**点击播放没反应**

检查播放器路径是否存在；留空时使用 Windows 默认关联。播放器错误会写在 `data/logs/` 的服务端日志里。

**右下角没有托盘图标**

确认双击的是根目录的 `Index.vbs`，不是 `start.ps1`。如果 Node 未安装或 8090 被占用，托盘点会显示停止状态；右键“打开日志目录”查看 `tray.log`、`server-*.err.log`。

**托盘图标是灰色的**

服务没有启动或健康检查失败。右键“启动服务”；如果仍失败，看日志里的 qBittorrent/端口/Node 报错。

**关闭命令行后服务也停了**

这是正常的：服务由托盘托管。日常请用 `Index.vbs`；直接运行 `npm start` 时关掉终端就会停服。

**日志在哪里**

`data/logs/`：`tray.log`、`server-*.out.log`、`server-*.err.log`、`setup.log`。托盘右键可以直接打开目录。
