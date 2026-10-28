# AGENTS.md

面向后续开发会话与代理。语言：中文。  
目标：少读无关文件、少跑无效命令、快速定位改动点。

## 1. 当前状态

- 2026-10-28 仓库已从 Android 版清零重建；旧历史不再保留。
- 当前是 **PC 本地网页服务**：Node 24 + Fastify + EJS/HTMX + SQLite。
- BT 交给 qBittorrent Web API；播放交给本机播放器；只索引已完成文件。
- 仅绑定 `127.0.0.1`，默认端口 8090，无登录。
- 本地数据：`data/index.db`、可选 `config.json`，都不进 Git。
- 不迁移 Android 数据。

## 2. 命令

```powershell
npm install --registry=https://registry.npmmirror.com
npm run dev        # tsx watch
npm run typecheck
npm test
npm run build      # tsc + 复制 views/public 到 dist
npm start          # 生产启动
.\start.ps1        # 自动安装/构建并启动
```

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

## 8. 已知坑

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

## 9. 后续待办

- 局域网访问 + 简单登录（如需）。
- HTTP 源播放器的 Cookie/Referer 支持。
- 手动导入 qBittorrent 里已有的任务。
- 规则变更后的自动重索引。
- 下载中的顺序播放（目前明确不做）。
- 更完整的 qBittorrent 分类映射。
