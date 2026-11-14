# BrainGym

简体中文的 Web 健脑游戏合集，提供三种 N-back 和正序／倒序 Corsi 方块顺序记忆，支持游客练习、个人 Token 登录、私人训练历史与最佳成绩，适配电脑和手机。

训练大厅中，三种 N-back 模式各对应一张卡片。选择“开始训练”后查看规则、选择难度并开局。空间模式用空格标记位置匹配；位置＋颜色模式使用固定 6 色，分别用 F/J 或两个按钮标记位置/颜色匹配。三元素模式在彩色格内显示 1～9 数字，分别用 F/J/K 或三个按钮标记位置/颜色/数字匹配。每种模式各路共用 N，哪项匹配就按哪项，不匹配的维度不操作。

个人记录按模式查看历史和最佳成绩。双路和三路模式展示综合分及分项表现，综合分是各路未舍入平衡准确率的平均值。从结果页进入个人记录时，会选中本局模式；记录页的训练入口随当前选择切换。通过顶部导航或直接打开记录页时，默认选中空间模式。完整规则见 [N-back Wiki](docs/wiki/n-back.md)，本次三路验证见[验收记录](docs/verification/triple-n-back.md)。

“顺序记忆 · Corsi 方块”的正序和倒序从同一张大厅卡片进入，在九宫格中复现亮起序列。首次从 2 格开始，每级固定两题，至少一题正确便增加 1 格，玩法长度不设固定上限；成绩为最高通过长度。下局取上一局各级首题就答对的最高长度；若开局首题失败，则优先从本局起始长度减 1 起步，最低 2 格。

账号的两方向进度、历史和最佳独立，可确认“从 2 格重新开始”并保留历史与最佳。游客起点仅在当前页面保留，刷新回到 2 格。完整合同见 [Corsi Wiki](docs/wiki/corsi.md)，验证范围见 [Corsi 验收记录](docs/verification/corsi-blocks.md)。

## 安装与离线练习

支持 PWA：通过支持安装的 Chrome/Edge 浏览器菜单，或 iPhone/iPad Safari 的“添加到主屏幕”安装；启动后进入训练大厅，页面不额外提示安装。目标平台的实际验收状态见 [PWA 验收记录](docs/verification/pwa-support.md)。

首次需联网完成资源缓存，之后可离线打开并明确选择“以游客身份练习”。离线游客成绩只在当前结果页展示，恢复联网或登录后也不补传；登录、个人记录与成绩保存仍需网络。浏览器清除缓存、首次缓存失败或尚未完成时，离线启动不可用。

新版本在后台准备，不强制刷新；关闭所有 BrainGym 标签页和独立窗口后，下次打开使用已准备的新版本。安装、更新与缓存排查见 [PWA 运维说明](docs/wiki/operations.md#安装与使用-pwa)。

## 本机开发与演练

需要 Node.js 24 或更高版本。

```powershell
npm ci
npm run cli -- user:create "开发练习账户"
npm run dev
```

另开一个终端执行 `npm run web`，打开 **http://127.0.0.1:5173**。API 默认绑定 `127.0.0.1:3002`，Vite 同源代理 API；两者不会占用正式托管的 3001，也不占用既有 Docker 默认 3000。

开发启动、预览和普通 CLI 默认使用当前工作区 `.runtime/development/braingym.sqlite`，开发身份与成绩不转入正式环境。创建命令只在本次输出明文 Token，请妥善保存；CLI 环境提示写 stderr，stdout 保持 JSON。开发数据库误指其它目录、环境冲突或端口冲突时直接失败。

可将 `.env.example` 复制为未跟踪的 `.env.development.local`，通过 `DEV_API_PORT`、`DEV_WEB_PORT` 调整开发端口；API 与 Vite 读取同一配置。`npm run build` 后运行 `npm start` 可从 `http://127.0.0.1:3002` 预览生产构建，仍使用开发库。构建只更新当前开发工作区的 `dist`，不触及正式程序。

## WheelMaker 托管

正式程序的目标目录固定为 `D:\Apps\BrainGym`，现有 WheelMaker 直接启动 Node 根进程；数据库沿用现有定义的绝对路径，入口、`/braingym/`、3001 和应用标识保持。日常开发、构建、测试、提交和合并均不会发布。

首次迁移完成前，旧实例仍可能读取原仓库 `dist`。原主工作区存在旧默认库且没有正式发布标记时，`npm run build` 会拒绝覆盖；使用独立 worktree 或演练候选目录，直到迁移验收完成。当前正式位置以验收记录为准。

新功能先演练，代码通过验证后合入并推送 main，再显式发布。运行以下命令时保持当前 main 的运行源码无未提交修改：

```powershell
npm run rehearse
# 使用上条命令输出的 candidate 目录，保持引号。
$releaseCandidate = '<candidate 目录>'
npm run release -- deploy --candidate $releaseCandidate
npm run release -- status
```

`rehearse` 在隔离候选中完成检查、双路径浏览器测试、Vite 演练、生产依赖准备及真实隔离 Hub 验证；功能分支也可演练，但 `deploy` 只接受可对应已提交 main 的有效候选。发布时短暂停服，备份后复制已验证产物，不在正式目录构建或安装依赖。失败恢复原程序、定义和运行状态，不回滚数据库；恢复未完成时用 `npm run release -- recover` 处理，后续发布会拒绝覆盖现场。

发布控制复用现有 Registry 认证。若 Hub 配置不含控制 Token，在主仓库未跟踪的 `.env.production.local` 中设置 `BRAINGYM_REGISTRY_TOKEN`，自定义 Hub 时设置 `WHEELMAKER_STATE_DIR`；不要把认证写入开发配置或聊天记录。真实入口从现有 Hub 定义读取，不从示例域名推断。

定义未变的发布不 Reload。首次迁移等定义变更需要全局 Reload，必须证明其它应用无待加载变化并取得配置文件保护；只有 BrainGym 一项时也核对实际 Monitor 集合，存在其它应用但缺少可信已加载基线时在停服前拒绝。`configure-wheelmaker.ps1` 仅预览正式目录定义，`-Apply` 已停用；历史公网预检及身份准备脚本也已退役，防止切走正式 Forwarding 或写入正式测试身份。

完整步骤见 [运维 Wiki](docs/wiki/operations.md#接入-wheelmaker)，本次实际状态见 [环境隔离验收记录](docs/verification/dev-production-isolation.md)。历史验收不代表本次已完成真实迁移。

## Docker

```powershell
docker compose up --build -d
docker compose exec braingym node dist/server/server/cli.js user:create "我的训练账户"
```

默认只将服务暴露到本机 `127.0.0.1:3000`，使用 `braingym-data` 命名卷持久保存 SQLite 数据。重建或 `docker compose down` 后再次启动仍保留数据；不要使用 `down -v`，该选项会删除数据卷。

通过 `PORT` 修改宿主机端口时，同时将 `APP_ORIGIN` 改为浏览器实际访问的 origin；例如端口 8080 对应 `http://127.0.0.1:8080`。否则来源校验会拒绝登录和成绩上传。

线上通过 HTTPS 反向代理访问时，将 `APP_ORIGIN` 设为实际 HTTPS origin，`COOKIE_SECURE=true`。写接口严格校验 Origin，必须与浏览器实际访问地址完全一致。直接 HTTP 的本地体验使用 `COOKIE_SECURE=false`；不要将这种配置作为公网生产配置。

## Token 运维

开发账户使用普通 CLI；正式账户使用显式入口，它读取现有 Hub 定义并执行现役程序的 CLI，不依赖 Registry 在线登录：

```powershell
npm run cli -- user:list
npm run cli -- token:rotate <user-id>
npm run cli -- token:revoke <user-id>
npm run cli -- token:issue <user-id>
npm run cli:production -- user:list
npm run cli:production -- token:rotate <user-id>
```

`user:create` 同时创建用户并发放 Token。`rotate` 换发 Token，并立即使旧 Token 与该用户全部会话失效，历史保留；`revoke` 停止该用户所有登录；`issue` 仅在没有有效 Token 时发放。数据库只保存凭据摘要，无法找回旧明文。在容器中运行时，将命令前缀替换为 `docker compose exec braingym node dist/server/server/cli.js`。

## 验证

```powershell
npm run typecheck
npm run build
npm test
npx playwright install chromium
npm run test:e2e
```

浏览器测试使用独立的 `data/e2e-*.sqlite`，不会操作默认账户库；可通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指向已有 Chromium。测试覆盖游客结果不补传、前台中断、移动端输入、上传失败、响应丢失、身份失效及跨标签页账号切换。

设置 `$env:E2E_BASE_PATH='/braingym/'` 后再次执行 `npm run test:e2e`，验证同一构建在前缀路径下的运行；验证结束后用 `Remove-Item Env:E2E_BASE_PATH` 清除该测试配置。

后台中断场景由原生 Chromium CDP 脚本验证，避免 Playwright 的强制前台设置掩盖真实 `visibilitychange`。Docker 持久化验收可在镜像构建后执行 `./scripts/verify-docker.ps1 -Image <image-name>`，脚本使用并清理专用测试容器和数据卷，不操作应用的数据卷。

游戏规则、数据与接口、部署细节见 [项目 Wiki](docs/wiki/architecture.md)，逐项验证结果见 [验收记录](docs/verification/braingym-mvp.md)。
