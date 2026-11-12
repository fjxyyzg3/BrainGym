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

- 开发迭代按实际变更选择针对性验证；代码及影响运行的配置、脚本、依赖变更，提交前必须依次通过 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`。验证失败禁止提交，不得削弱测试或验收门槛来消除失败。
- 构建和运行时测试不得并行，Vite 会清空测试进程读取的 `dist/client`。浏览器测试首次需 `npx playwright install chromium`，或设置 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 使用已有 Chromium。
- 涉及基础路径、资源或 Cookie Path 时，同一构建还须设置 `$env:E2E_BASE_PATH='/braingym/'` 后运行 `npm run test:e2e`，完成后用 `Remove-Item Env:E2E_BASE_PATH` 清除配置。
- 测试使用临时 SQLite 或独立的 `data/e2e-*.sqlite`；手动验证、测试 CLI 和脚本也必须显式使用隔离的 `DATABASE_PATH`，不要操作默认账户库。
- 后台中断沿用现有原生 Chromium CDP 验证；隔离 Hub、Docker 与真实公网验收先读运维及验收文档，确认脚本的前置环境和副作用。
- 纯文档改动（含本文件）检查路径、链接、命令、环境变量、格式及真实入口与凭据，不要求应用测试，但仍须完成下方安全审查；涉及依赖、脚本或运行配置时不适用该例外。
- 对最终变更仍有效的验证与安全审查证据在提交、推送阶段复用；仅在新增修改、环境变化、失败或疑点使证据失效时重跑。不为低影响可逆修改新增只复述实现的测试。

## 必须保持的行为与边界

- 游戏时序由单调时间推进，每步只接受首次输入；未完成对局在离开、切后台或锁屏时作废。变更出题、时序或计分时同步规则、版本合同和相关测试，保留历史成绩语义。
- 游客结果不在登录后补传；完成结果仅保留在当前页面，失败可手动重试，不建立持久化离线队列。
- 成绩归属由有效服务端会话确定；`startedByUserId` 只作开局身份前置校验。保持 `(user_id, result_id)` 幂等保存、冲突拒绝及服务端复算分数。
- `APP_BASE_PATH` 在运行时选择 `/` 或 `/braingym/`；资源、API、重定向与 Cookie Path 都必须兼容，不硬编码根路径或为前缀另建一份构建。
- WheelMaker 直接托管前台 Node 根进程；托管 stdout 仅承载协议，诊断写 stderr。普通启动不依赖 stdin；Forwarding 故障不应终止核心 HTTP / SQLite 服务。
- 数据库默认位于 `data/braingym.sqlite`。保留用户、Token 与历史；备份按运维流程停止所有写入进程并复制完整数据库目录，不只复制活动中的 SQLite 主文件。日常重启不使用 `docker compose down -v`。
- 不提交 `.env`、Token、SQLite、依赖、构建或验收临时数据；部署、Monitor 操作与 Hub 配置写入需在当前任务授权范围内执行。

## 网络安全与凭据

以下约束参考 BillBoard 的网络入口约定和 `billboard-security-review` 清单，按 BrainGym 的 Fastify、SQLite 与 WheelMaker 边界执行。

- 生产公网登录和写入必须经过 HTTPS；`APP_ORIGIN` 精确匹配实际浏览器 origin，`COOKIE_SECURE=true`。本机 HTTP 仅用于开发和健康检查，不作为公网明文登录通道。
- 宿主机端口仅绑定回环：普通运行默认 `127.0.0.1:3000`，WheelMaker 使用 `127.0.0.1:3001`；Compose 保持 `127.0.0.1:${PORT:-3000}:3000`，禁止宿主机绑定 `0.0.0.0` 或裸端口发布。容器内部监听 `0.0.0.0` 不等于允许宿主机对公网发布。
- 普通模式不信任转发头；托管模式只接受可信 IPv4 回环对端传入的单值客户端 IP，地址不可确认时拒绝登录，不回退共享限流额度。外部转发访问限制、转发头清洗及日志控制须核验真实配置，不能从示例配置推定已安全。
- 按实际 HTTPS 入口核验 CSP、`X-Content-Type-Options`、`Referrer-Policy`、防嵌入策略及适用的 HSTS / `Permissions-Policy`；不得无证据声称代理已补齐安全头。修改策略需验证静态资源、登录及前缀路径，不能为消除报错直接放宽 CSP 或来源校验。
- 路径前缀、Cookie Path 和 SameSite 不隔离同 Origin 应用；新增同源应用或改变发布权限时重新核验信任边界，引入不可信应用需独立 Origin。
- 跟踪文件和新增提交禁止写入真实账号、密码、Token、密钥、生产域名、子域名、公网 IP、隧道／云主机地址或私有服务 URL；示例使用占位符，真实值只放未跟踪环境文件或私有部署配置。检查 `.gitignore`、`.dockerignore` 和镜像输入，防止夹带凭据、数据库、备份及本地工作数据。
- Token 和会话在服务端只持久化摘要；保持登录限流、Cookie 的 HttpOnly / SameSite、HTTPS Secure、有效期和撤销语义。不把 Token 或私人训练数据写入 URL、客户端日志、分析工具、localStorage 或 IndexedDB；会话通过受保护的认证 Cookie 传递。服务日志不记录请求正文、Cookie 或凭据，扫描结果先脱敏再引用。
- 疑似泄露先核实真实值和影响范围，不把占位符或变量名当事故；确认后在已有授权内阻断暴露、轮换受影响凭据，核验旧值失效且数据保留。既有入口引用与历史泄露需记录清理范围，未获授权的停服、历史改写、强推或破坏性清理先准备可审查方案再请求批准。

## 安全审查与代码检查

- 验收或提交任何变更前（含纯文档），以 `git status --short`、`git diff --stat`、实际 diff 和变更文件列表界定范围；按认证／会话、数据访问、浏览器暴露、网络部署、凭据文档、依赖与测试分类检查。清单内置于本文件，无需依赖 BillBoard 仓库的 skill。
- 私人历史、最佳成绩和成绩写入必须从有效会话派生用户身份，并按用户收敛所有查询与写入；UI 隐藏、难猜 ID、客户端 `startedByUserId` 都不是授权。检查匿名、跨账号、过期／撤销会话、跨标签页切换及重试的拒绝行为，换发或吊销 Token 后旧会话不得继续访问。
- 检查不可信请求的类型、长度、范围和请求体上限，SQL 使用参数绑定；成绩校验、服务端复算、事务、唯一约束和幂等冲突不得被绕过。不要新增原始 HTML 注入、任意路径读写或未经校验的外部请求入口。
- 认证、Fastify、React／Vite、SQLite 访问、网络客户端、构建或部署相关依赖变更，须检查 `npm audit --json`，核实告警的可达性与影响并补充必要回归验证；不得用忽略告警或未经评估的破坏性升级冒充修复。无明确需求和审查，不新增认证 provider、安全敏感依赖、遥测或远程日志。
- 按变更面选择能证明安全属性的最小检查，并满足上方提交前验证门槛；认证与数据访问覆盖服务端测试，登录与账号切换覆盖浏览器测试，网络与部署检查绑定、代理、Cookie、安全头和打包输入，纯文档执行针对性文本扫描。
- 审查用中文输出 **Findings**、**Verification**、**Residual Risk**：发现按严重度排序并附文件／行号，P0 为主动泄露或跨账号数据暴露，P1 为很可能可利用的回归，P2 为加固或测试缺口；验证列实际命令与通过／失败，残余风险列未检查项。无阻塞时明确说明；存在阻塞或必需验证缺失时不得标为通过。

## 文档与 Git

- 行为、配置或部署方式改变时同步对应 README / Wiki；本文件只保留执行约束和入口，详细机制维护在现有文档中。
- 持久化修改前读取并遵守 [Git 工作流偏好](docs/user/git-preferences.md)：先检查现有改动及远端状态，按偏好执行 prepare、验证、提交和 finalize。
- 只暂存本任务文件，保留任务外修改；分支、worktree、同步、提交、推送、合并和清理由上述偏好统一决定，不在本文件维护第二套配置。
