> 摘要：本地、Docker 与 WheelMaker 的启动更新，PWA 安装与缓存排查、Token 管理和 SQLite 数据保留。

# 启动与管理 BrainGym

## 本地运行

安装 Node.js 24 或更高版本，在项目根目录执行：

```powershell
npm ci
npm run build
npm run cli -- user:create "训练账户"
npm start
```

创建命令输出稳定用户 ID 和明文 Token。打开 `http://127.0.0.1:3000`，在“Token 登录”中输入 Token。创建命令与服务默认使用 `data/braingym.sqlite`；自定义 `DATABASE_PATH` 时，两者必须指向相同文件。

## 安装与使用 PWA

生产构建提供安装资源；公网使用既有 HTTPS 入口，回环 HTTP 仅用于本地开发和验证。Chrome/Edge 通过浏览器菜单安装应用；iPhone/iPad Safari 使用**分享 → 添加到主屏幕**，若系统提供“作为 Web App 打开”，保持开启。图标启动进入当前路径的训练大厅，页面没有安装按钮或安装提示。目标平台的实际验证范围见 [PWA 验收记录](../verification/pwa-support.md)。

首次联网打开后，需要完成公共外壳和静态资源缓存。可断网关闭再打开，检查训练大厅和准备页是否可用；尚未完成缓存、缓存失败或被浏览器回收时需重新联网。断网练习需明确选择**以游客身份练习**，本局成绩只留在当前结果页，不在恢复联网或登录后补传。登录、退出、私人记录和成绩保存需要联网；已有会话不会仅因网络故障被撤销。

已在线验证身份后开始的对局，途中断网仍可完成，保存失败可留在结果页手动重试。刷新或离开会失去待保存结果。未完成对局的离开、切后台或锁屏作废规则同样适用于独立窗口。

新版本会在联网访问、窗口获得焦点或恢复网络时检查并准备；它不强制刷新当前页面。关闭所有 BrainGym 标签页和独立窗口，再打开即可使用已经准备好的版本。仅关闭一个窗口或刷新仍有旧页面的应用，不会主动切换版本。新版下载或校验失败时继续使用完整旧版，重新联网打开后可重试准备。

确需清理异常缓存时，在浏览器开发工具中找到当前应用的 Service Worker 作用域，仅注销该 worker，并删除同一路径对应的 `braingym:pwa:` 缓存。根路径前缀为 `braingym:pwa:%2F:`，托管路径为 `braingym:pwa:%2Fbraingym%2F:`。关闭全部相关页面后联网重开。不要把清除整个 Origin 的站点数据当作常规更新步骤，它会影响同 Origin 其他应用及登录状态；不要删除其他路径的 worker 或缓存。

`npm run web` 不注册生产 worker。若曾在同一 Origin 运行生产版，使用独立开发端口或按上述方法只移除对应 worker。图标由已提交的 PNG 提供，修改原有标识后可设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 并运行 `node scripts/generate-pwa-icons.mjs`，从 `public/favicon.svg` 重新生成。

## Docker 运行

```powershell
docker compose up --build -d
docker compose exec braingym node dist/server/server/cli.js user:create "训练账户"
```

服务以非 root 用户运行，默认仅将 3000 端口映射到本机。通过 `PORT` 调整宿主机端口时，必须同步将 `APP_ORIGIN` 改为实际访问的 origin，否则登录和成绩上传会被拒绝。`braingym-data` 命名卷保存 `/app/data`。重建镜像或删除容器不会删除命名卷；`docker compose down -v` 会删除数据，不能用于保留成绩的日常重启。

## 管理凭据

```powershell
npm run cli -- user:list
npm run cli -- token:rotate <user-id>
npm run cli -- token:revoke <user-id>
npm run cli -- token:issue <user-id>
```

`rotate` 换发 Token，旧 Token 无法再次登录，全部旧会话立即失效。`revoke` 吊销凭据和全部会话，`issue` 为已无有效凭据的用户重新发放。用户身份和历史不变；退出网页只撤销当前会话。明文 Token 仅在发放或换发时输出，数据库无法找回旧值。

容器内管理使用前缀 `docker compose exec braingym node dist/server/server/cli.js`，替换以上 `npm run cli --`。

## 接入 WheelMaker

在当前 Windows Hub 所在机器安装 Node.js 24+，保留现有 `data/braingym.sqlite`。先确认托管使用的 3001 端口可用，然后在仓库根目录执行：

```powershell
npm ci
npm run build
# 先从私有部署配置设置当前终端的 APP_ORIGIN，再生成定义。
./scripts/configure-wheelmaker.ps1
```

脚本从当前进程的 `APP_ORIGIN` 读取私有 HTTPS origin，也可传入 `-AppOrigin`；两者都未提供或值含路径、查询参数、fragment、凭据时，在生成预览或修改 Hub 前拒绝执行。PowerShell 不自动读取 `.env`。文中的 `apps.example.com`、`registry.example.com` 仅为保留示例，不代表实际部署或可访问入口。

查看输出中指定的定义预览，核对 Node 绝对路径、仓库目录和数据库路径。预览含私有入口，保存在忽略目录 `data/wheelmaker-verification/`，不要提交或粘贴到公开报告。脚本默认使用当前用户的 `.wheelmaker`；自定义 Hub 状态目录时，预览和应用均传入相同的 `-StateDir`。

1. 沿用预览时相同的 `APP_ORIGIN` 或 `-AppOrigin` 及 `-StateDir`，加上 `-Apply` 执行配置合并。脚本在状态目录 `.tmp` 下建立与原配置 ACL 相同的备份，再原子替换 `config.json`；它只合并 `braingym-process`，保留其他配置，并输出备份位置。
2. 在 WheelMaker 桌面客户端选择当前 Windows Hub，进入 Monitor，执行 **Reload**。
3. 确认 BrainGym 为 ready，PID 对应实际 Node 根进程，并能查看 stderr 启动日志。
4. 检查 Forwarding 条目 `braingym` 为 ready，target 为 `http://127.0.0.1:3001`，公网 URL 为私有 `APP_ORIGIN` 加 `/braingym/`。
5. 打开公网 URL，验证页面、Token 登录、成绩与退出。仅有 Forwarding ready 不能证明业务验收通过。

脚本生成的定义直接使用 `node.exe`、参数 `dist/server/server/main.js`，cwd 为仓库目录。不要将 `npm` 或 shell 作为托管根进程。固定环境为 `HOST=127.0.0.1`、`PORT=3001`、`APP_BASE_PATH=/braingym/`、`COOKIE_SECURE=true`、`NODE_ENV=production`，以及绝对 `DATABASE_PATH`、`WHEELMAKER_STATE_DIR` 和 `WHEELMAKER_SERVICE_ID=braingym`；`APP_ORIGIN` 使用上述私有输入。`WHEELMAKER_APP_MANAGED` 由 Hub 注入。

Registry 地址由私有 Hub 配置维护，BrainGym 通过本机 IPC 发布，不需要 Registry 密码或 Token。普通命令行启动时，不要注入控制协议；本机可用 `http://127.0.0.1:3001/braingym/api/health` 探测健康，登录和写入使用公网 HTTPS。

公网预检与验收脚本 `verify-wheelmaker-preflight.mjs`、`verify-wheelmaker-public.mjs` 同样要求进程环境提供有效 HTTPS `APP_ORIGIN`，并在读取验证身份或发起连接前校验；可通过 `node --env-file=.env scripts/verify-wheelmaker-public.mjs` 加载自行维护且未跟踪的 `.env`。预检的 `WHEELMAKER_STATE_DIR` 默认取当前用户的 `.wheelmaker`，自定义时从进程环境传入。运行前按验收记录准备临时身份；这些脚本会访问真实入口并清理该临时身份，不是普通测试命令。含实际 URL 的机器报告仅保存到忽略目录，控制台结果隐藏 URL，公开截图须先检查入口和凭据。

该部署依赖同 Origin 应用可信、发布权限受控，以及网关正确清洗转发头。Cookie Path 和路径前缀不隔离同域应用；完整条件见 [身份与代理信任边界](architecture.md#身份与代理信任边界)。

## 更新或恢复托管实例

1. 在 Monitor 对 BrainGym 执行 **Stop**，确认根进程结束、3001 端口释放且注册撤销。
2. 停止指向同一数据库的 CLI 或其他应用进程，按下方方法备份数据。
3. 更新源码，执行 `npm ci`、`npm run typecheck`、`npm test` 和 `npm run build`。不要在运行时测试读取构建目录的同时重新构建。
4. 保留原数据库，在 Monitor 执行 **Start**。确认新 PID 就绪、Forwarding 恢复，再用原 Token 核对历史和一次新成绩。

只更新构建无需重新合并 Hub 配置。定义变化时重跑配置脚本并 Reload。恢复配置时先 Stop BrainGym，再从脚本输出的备份中恢复本条定义；若期间有其他配置变化，逐项合并，避免整体回滚他人的修改。恢复构建时选用兼容当前 schema 的版本。

## 排查托管故障

- Monitor 未就绪：检查直接 Node 路径、cwd、前端构建、端口冲突及数据库权限，查看 stderr；stdout 只能包含协议帧。
- Monitor 报 storage 异常：检查数据库锁、磁盘和权限，解除故障后确认完整 healthy 快照已清除旧诊断。仅发布失败不会把核心健康标为失败。
- Monitor 就绪但 Forwarding 未就绪：核对两端 `WHEELMAKER_STATE_DIR`、服务 ID、target 及 Hub 的转发配置。应用会自行退避重试；已注册的连接长期无推送，可以是正常状态。
- 登录返回 `503/CLIENT_IP_UNAVAILABLE`：核对请求确实来自回环代理，且网关传入一个非回环客户端 IP；查看脱敏原因分类。修复代理后使用原 Token 重试，不启用共享额度回退。
- 登录或保存返回 403：核对浏览器实际 Origin 与 `APP_ORIGIN`；本机 HTTP 登录不属于托管配置的写入入口。

## 配置 HTTPS 与数据保留

线上使用 HTTPS 反向代理时，将 `APP_ORIGIN` 设置为浏览器实际访问的 HTTPS origin，且无路径和尾斜杠，同时设置 `COOKIE_SECURE=true`。来源不一致的写请求会被拒绝；本地 HTTP 使用 `false`。Compose 自动读取 `.env`，普通 `npm start` 不读取该文件，可改用 `node --env-file=.env dist/server/server/main.js`。

备份前停止 API 及所有管理进程，再复制完整数据库目录；恢复到原路径后重新启动。不要只复制正在写入的 SQLite 主文件，WAL 可能仍包含已提交数据。旧版应用不能直接打开更高版本数据库，当前 schema version 为 1。

来源：[README](../../README.md)、[接入 spec](../scope/2026-11-12-wheelmaker-integration.md)、[配置脚本](../../scripts/configure-wheelmaker.ps1)、[Compose](../../compose.yaml)、[运行入口](../../src/server/main.ts)、[CLI](../../src/server/cli.ts)、[存储](../../src/server/store.ts)。实际验证范围见 [WheelMaker 验收记录](../verification/wheelmaker-integration.md)。
