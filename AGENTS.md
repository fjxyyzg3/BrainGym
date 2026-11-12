# BrainGym Agent 指南

适用于整个仓库。沟通、文档及面向用户的文案默认使用简体中文；代码标识符沿用现有英文风格。

## 项目与入口

- 简体中文 Web 健脑游戏合集；当前提供九宫格空间 N-back、游客练习、个人 Token 登录、私人历史与最佳成绩。
- 技术栈：Node.js 24+、TypeScript strict / ESM、React 19、Vite 7、Fastify 5、Node 内置 `node:sqlite`。
- 使用与配置先读 [README](README.md) 和 [.env.example](.env.example)；架构与身份边界见 [架构 Wiki](docs/wiki/architecture.md)，游戏规则见 [N-back Wiki](docs/wiki/n-back.md)，部署和数据维护见 [运维 Wiki](docs/wiki/operations.md)。
- `docs/scope/`、`docs/plans/`、`docs/verification/` 保存需求、实施与验收证据；历史验收记录不能代替本次验证。

## 目录与代码约定

- `src/client/`：React 页面、样式、API 客户端与内存游戏引擎；`public/`：静态资源。
- `src/server/`：Fastify API、SQLite、用户管理 CLI、进程生命周期及 WheelMaker 协议。
- `src/shared/`：共享类型、游戏规则和基础路径；前后端复用，不各自复制计分或路径逻辑。
- `tests/*.test.ts`：Node 测试；`tests/e2e/`：Playwright；`scripts/`：开发、部署和环境验收工具。
- 服务端及其共享模块的相对导入沿用 `.js` 扩展名，以兼容 NodeNext 编译输出。保持现有格式，只格式化本次修改的文件。

## 开发与启动

- 使用 npm 和已提交的 `package-lock.json`；首次安装运行 `npm ci`。
- 开发需两个终端：API 终端先设置 `$env:APP_ORIGIN='http://127.0.0.1:5173'` 再运行 `npm run dev`（3000）；另一终端运行 `npm run web`（5173），浏览器访问 `http://127.0.0.1:5173`，API 由 Vite 代理。
- 生产构建运行 `npm run build`，随后 `npm start`；默认入口为 `http://127.0.0.1:3000`。CLI 使用 `npm run cli -- <命令>`，具体账户命令见 README。
- `npm start` 不自动加载 `.env`；需要时使用 `node --env-file=.env dist/server/server/main.js`。`APP_ORIGIN` 必须是实际浏览器 origin，且不带路径或尾斜杠。

## 验证

- 代码变更按顺序执行 `npm run typecheck`、`npm run build`、`npm test`；构建和运行时测试不得并行，Vite 会清空测试进程读取的 `dist/client`。
- 涉及页面、交互、身份或路径时，在构建后运行 `npm run test:e2e`；首次需 `npx playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 使用已有 Chromium。
- 涉及基础路径、资源或 Cookie Path 时，同一构建还须设置 `$env:E2E_BASE_PATH='/braingym/'` 后运行 `npm run test:e2e`，完成后用 `Remove-Item Env:E2E_BASE_PATH` 清除配置。
- 测试使用临时 SQLite 或独立的 `data/e2e-*.sqlite`；手动验证、测试 CLI 和脚本也必须显式使用隔离的 `DATABASE_PATH`，不要操作默认账户库。
- 后台中断沿用现有原生 Chromium CDP 验证；隔离 Hub、Docker 与真实公网验收先读运维及验收文档，确认脚本的前置环境和副作用。
- 纯文档改动检查内容、链接和格式即可；汇报实际执行的检查及未验证范围。

## 必须保持的行为与边界

- 游戏时序由单调时间推进，每步只接受首次输入；未完成对局在离开、切后台或锁屏时作废。变更出题、时序或计分时同步规则、版本合同和相关测试，保留历史成绩语义。
- 游客结果不在登录后补传；完成结果仅保留在当前页面，失败可手动重试，不建立持久化离线队列。
- 成绩归属由有效服务端会话确定；`startedByUserId` 只作开局身份前置校验。保持 `(user_id, result_id)` 幂等保存、冲突拒绝及服务端复算分数。
- Token 和会话只存摘要；保持 Cookie 的 HttpOnly / SameSite、HTTPS Secure、固定 Origin 校验和登录限流。日志不记录请求正文、Cookie 或凭据。
- 保持普通模式不信任转发头、托管模式严格校验代理来源与单值客户端 IP；地址不可确认时拒绝登录，不放宽为共享限流额度。
- `APP_BASE_PATH` 在运行时选择 `/` 或 `/braingym/`；资源、API、重定向与 Cookie Path 都必须兼容，不硬编码根路径或为前缀另建一份构建。
- WheelMaker 直接托管前台 Node 根进程；托管 stdout 仅承载协议，诊断写 stderr。普通启动不依赖 stdin；Forwarding 故障不应终止核心 HTTP / SQLite 服务。
- 数据库默认位于 `data/braingym.sqlite`。保留用户、Token 与历史；备份按运维流程停止所有写入进程并复制完整数据库目录，不只复制活动中的 SQLite 主文件。日常重启不使用 `docker compose down -v`。
- 不提交 `.env`、Token、SQLite、依赖、构建或验收临时数据；部署、Monitor 操作与 Hub 配置写入需在当前任务授权范围内执行。

## 文档与 Git

- 行为、配置或部署方式改变时同步对应 README / Wiki；本文件只保留执行约束和入口，详细机制维护在现有文档中。
- 持久化修改前读取并遵守 [Git 工作流偏好](docs/user/git-preferences.md)：先检查现有改动及远端状态，按偏好执行 prepare、验证、提交和 finalize。
- 只暂存本任务文件，保留任务外修改；分支、worktree、同步、提交、推送、合并和清理由上述偏好统一决定，不在本文件维护第二套配置。
