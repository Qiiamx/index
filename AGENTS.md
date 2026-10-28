# AGENTS.md

面向后续开发会话与代理。语言：中文。  
目标：少读无关文件、少跑无效命令、快速定位改动点。

## 1. 当前状态

- 2026-10-28 仓库已从 Android 版清零重建；旧历史不再保留。
- 当前是 **PC 本地网页服务**：Node 24 + Fastify + EJS/HTMX + SQLite。
- BT 交给 qBittorrent Web API；播放交给本机播放器；只索引已完成文件。
- 仅绑定 `127.0.0.1`，默认端口 8090，无登录。
- 日常入口是根目录 `Index.vbs`：右下角托盘，Node 服务隐藏运行，不弹命令行。
- 服务不做 Windows 服务（session 0 无法把播放器开在桌面）。
- 本地数据：`data/index.db`、可选 `config.json`，都不进 Git。
- 不迁移 Android 数据。

## 2. 命令

```powershell
npm install --registry=https://registry.npmmirror.com
npm run dev        # tsx watch
npm run typecheck
npm test
npm run build      # tsc + 复制 views/public 到 dist
npm start          # 生产启动（会占用当前终端）
.\Index.vbs        # 日常：托盘启动，无控制台
.\start.ps1        # 开发：控制台启动并打开浏览器
```

- 托盘相关：`.\tools\install-startup.ps1` / `.\tools\remove-startup.ps1` 开关开机启动。
- 改完源码后要 `npm run build`，再在托盘菜单点“重启服务”才会加载新代码。

- **不要后台跑长命令**；一律前台 + 超时。
- npm 走 10808 代理可能卡在个别包并 `ECONNRESET`；默认用 npmmirror，不要无限重试。
- 命令超过 2 分钟无输出：检查 `node` 进程，必要时结束，不要继续等。

## 3. 结构

```text
src/server.ts                 启动入口
src/app.ts                    Fastify 注册、页面路由、表单动作
src/config.ts                 config.json / PORT / DATA_DIR
src/db/schema.ts              SQLite 建表
src/db/database.ts            打开 DB、seed 未分类文件夹
src/db/repositories.ts        所有仓储 + SettingsService
src/domain/models.ts          领域类型
src/domain/rules.ts           规则编译/校验/多级目录解析
src/sources/httpDirectory.ts  HTTP 目录解析
src/sources/rss.ts            RSS/Atom 解析
src/util/http.ts              undici + 可选 http 代理
src/qbittorrent/client.ts     qBittorrent Web API 5.x/旧版适配
src/qbittorrent/indexer.ts    已完成任务 -> items 索引
src/services/downloads.ts     提交/停止/删除任务
src/services/rss.ts           RSS 轮询与任务生成
src/playback/player.ts        启动本机播放器 + 观看记录
src/web/views/*.ejs           页面
src/web/public/app.css        样式
tray/IndexTray.ps1            托盘宿主（WinForms NotifyIcon）
Index.vbs                     无窗口启动器（wscript）
tools/make-icons.ps1          生成 assets/*.ico
tools/install-startup.ps1     开机启动快捷方式
tools/remove-startup.ps1      删除开机启动
assets/index.ico              运行中图标
assets/index-stopped.ico      停止图标
tests/*.test.ts               vitest
```

## 4. 数据与设置

SQLite 表：

```text
folders(id,parent_id,name,sort,created_at)
tags(id,name,group_name,created_at)
folder_tags(folder_id,tag_id)
sources(id,name,base_url,type,enabled,torrent_link_regex,last_error,last_fetched_at,created_at)
rules(id,source_id,target_folder_id,order_no,match_regex,display_name_regex,
      display_name_replacement,folder_regexes,enabled,created_at)
tasks(id,source_id,item_key,title,page_url,torrent_url,info_hash,qb_tag,
      rule_ids,state,error,created_at,updated_at,completed_at)
items(id,folder_id,task_id,item_key,title,rel_path,abs_path,size,added_at)
watch_history(id,folder_id,item_key,title,target,played_at)
settings(key,value)  -- key='app' 存 JSON
```

- 固定文件夹：`folder-unassigned`（未分类），不可删除。
- 删除文件夹只删数据库和关联 items，**不删物理文件**。
- 删除源会级联规则/任务/items，不删物理文件。
- 设置默认值在 `DEFAULT_SETTINGS`；qB 密码以明文存本机 SQLite。

## 5. qBittorrent 约定

- 连接地址默认 `http://127.0.0.1:8080`；无密码时依赖 localhost 免登录。
- 请求必须带 `Referer` / `Origin`（qB WebUI 的 CSRF 检查）。
- 5.x（Web API >= 2.11）用 `torrents/start|stop`；旧版回退 `resume|pause`。
- 添加任务：`autoTMM=true`、`tags=index,index-<taskId>`、category 可选；**不要设 savepath**。
- 已存在/失败返回 `Fails.` 或 409；当作失败显示。
- 只管理带 `index` 标签的任务；手动添加的任务不进库。
- 保存目录、分类路径、做种限制、Tracker、DHT、BT 代理全部在 qBittorrent 侧配置。
- 完成后用 `save_path + files[].name` 求绝对路径；`files[].name` 是相对路径，可能含根目录。
- 只索引视频扩展名且 `files[].progress >= 0.999`；只播已完成文件。

## 6. 规则

- `folderRegexes` 是目录层级，从片源根目录开始；`matchRegex` 是最终文件。
- 有目录规则时必须**层数完全一致**；没有目录规则时只匹配叶子文件名，可在任意深度。
- 改名只作用叶子；结果不能含 `/`、`\`、`..`。
- 规则按 `orderNo` 排序，第一条匹配生效；未匹配的 BT 文件进“未分类”。
- HTTP 目录在页面请求时实时递归读取（缓存单次请求），BT 文件在任务完成后写入 `items`。

## 7. 播放

- 设置 `playerPath` + `playerArgs`；`{file}` 会被替换成本地路径或 HTTP URL。
- 留空 `playerPath` 时用 `cmd /c start "" <target>`（Windows 默认打开方式）。
- 用 `spawn` + 参数数组，不经过 shell；本地路径必须是绝对路径且存在。
- 不记录文件内进度；只写 `watch_history` 的全局/文件夹上次观看。
- 修改播放器设置只影响下一次播放。

## 8. 托盘与进程

- 托盘是日常入口：`Index.vbs` → `cmd /c powershell -WindowStyle Hidden -File tray/IndexTray.ps1`。
- 托盘拥有 Node 子进程；退出托盘会先停 Node，不要做 Windows 服务（player 会开在 session 0，桌面看不到）。
- `Start-IndexServer` 用 `Start-Process -WindowStyle Hidden -RedirectStandardOutput/Error`；正常时 `MainWindowHandle = 0`。
- 健康检查用同步 `HttpWebRequest`（`Proxy = $null`）；不要在 WinForms UI 线程用 `HttpClient...GetAwaiter().GetResult()`，会死锁。
- 单实例用 `Local\IndexTray` mutex；第二次双击只打开浏览器。
- 自动重启最多 3 次；服务健康运行超过 60 秒后重置计数。
- 开机启动快捷方式：Startup 下的 `Index.lnk`，Target `wscript.exe`，参数指向 `Index.vbs`。
- 日志：`data/logs/tray.log`、`server-*.out.log`、`server-*.err.log`、`setup.log`、`tray-console.log`。
- 图标由 `tools/make-icons.ps1` 生成多尺寸 PNG ICO；不要手改 `.ico` 后忘记脚本。

## 9. 已知坑

1. `node:sqlite` 在 Node 24 仍是 experimental；生产启动用 `--disable-warning=ExperimentalWarning`。
2. npm 走本地 10808 代理可能单个包 20s+ 后断连；优先 npmmirror。
3. 不要用后台 shell 跑 npm/build/dev server；前台执行并设超时。
4. qB 5.x 的 `pause/resume` 已改名 `stop/start`；按 `app/webapiVersion` 判断。
5. qB 添加任务不要同时设置 `savepath` 和 `autoTMM`，否则 TMM 失效。
6. `files[].name` 是相对 save_path 的路径；多文件种子通常包含种子根目录。
7. EJS 里可选变量用 `locals.notice`；直接引用未传变量可能报错。
8. cheerio 不导出 `AnyNode` 类型；不要再写 `cheerio.AnyNode`。
9. 修改类请求有 `Origin` 校验；用脚本测试 POST 时带上 `Origin: http://127.0.0.1:8090`。
10. 服务只监听 127.0.0.1；要局域网访问得改 host 并自行加认证。
11. `watch_history` 只保留 500 条；不要把它当播放进度表。
12. 规则编辑后已有 `items` 不会自动重排；用下载页“重新索引”重建。
13. Windows PowerShell 5.1 按 ANSI 读取 `.ps1`；含中文的脚本必须保存为 **UTF-8 with BOM**，否则会解析失败并报“字符串缺少终止符”。
14. `Index.vbs` 保持 ASCII；它需要被 wscript 按 ANSI 读取。托盘输出重定向到 `tray-console.log`，避免从 shell 启动时继承调用方 stdout 导致命令不返回。
15. 测试托盘不要用 `Start-Process -Wait` 等 `Index.vbs`/`wscript`：PowerShell 可能等待整棵进程树。直接启动后用进程/健康检查验证。
16. 托盘 PowerShell 的 `Add-Type -AssemblyName System.Windows.Forms` 在隐藏窗口下正常；但 `NotifyIcon` 必须在 `Application.Run()` 之后才有消息循环，启动期间的 balloon 可能延迟显示。

## 10. 后续待办

- 局域网访问 + 简单登录（如需）。
- HTTP 源播放器的 Cookie/Referer 支持。
- 手动导入 qBittorrent 里已有的任务。
- 规则变更后的自动重索引。
- 下载中的顺序播放（目前明确不做）。
- 更完整的 qBittorrent 分类映射。
