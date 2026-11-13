# PWA Support Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 安装后进入训练大厅，缓存完成后可显式选择离线游客练习，保护私人数据并在全部旧页面关闭后更新。

**Scope Source:** [已批准 spec](../../scope/2026-11-12-pwa-support.md)

**Architecture:** Vite 插件以完整构建内容生成版本、资源摘要清单和原生 worker。Fastify 提供带当前基础路径的公共外壳及 manifest，worker 对每个发行版本完整校验再安装，API 始终走网络。React 仅在内存中处理网络状态与游客选择，不改变服务端鉴权或成绩协议。

**Tech Stack:** 现有 TypeScript / Vite / React / Fastify / SQLite，原生 Service Worker、Cache Storage 和 Web Crypto；不新增依赖。

**Verification:** `npm run typecheck` → `npm run build` → `npm test` → `npm run test:e2e` → 同一构建的 `E2E_BASE_PATH=/braingym/` e2e；真实两个发行版本的 worker 更新/失败回退测试；真机与实际安装证据独立记录，不以模拟代替。

---

### Task 1：公共外壳、构建版本与原生缓存

**Files:** 新建 `scripts/pwa-build.ts`、`src/pwa/worker.js`、`src/server/pwa.ts`、`src/client/pwa.ts`、`tests/pwa.test.ts`、`tests/e2e/pwa.spec.ts`；修改 `vite.config.ts`、`src/server/app.ts`、`src/client/main.tsx`、`index.html`；新增 `public/icons/` 图标。

**Acceptance:** `/` 与 `/braingym/` 运行同一构建；manifest 标识和启动地址正确；真实 worker 能离线冷启动；拒绝不完整/跨版本资源，所有 API 和其他路径不缓存。

- [x] RED：增加 HTTP 测试：请求当前路径 manifest 必须返回 `application/manifest+json`，`id/start_url/scope` 均等于基础路径，worker 缺失不得返回 HTML；运行 `node --import tsx --test tests/pwa.test.ts` 观察缺失功能的断言失败。
- [x] 构建：读取最终 HTML、JS/CSS 与明确图标白名单，以 SHA-256 生成内容版本及每资源摘要；HTML 增加发行标记；清单不含自身或任意目录内容。worker 作为独立原生脚本生成，基础路径由注册作用域解析。
- [x] 服务：`src/server/pwa.ts` 负责 manifest，`src/server/app.ts` 复用 HTML 路径处理，worker 返回可重验证响应；静态脚本与图标正常提供，API `no-store`、原 CSP 与 Cookie 不放宽。
- [x] 缓存：安装全部下载并核验摘要/媒体类型，HTML 验证构建标记及基础路径；失败只回收本次缓存。导航仅入口及 index，静态读取只白名单；不接管 API、未知、跨源或非 GET 请求。更新不 skipWaiting/claim/reload；激活只清理本路径旧版及失败残留。
- [x] 图标与注册：从现有 SVG 标识生成 PNG、maskable、Apple 图标并检查尺寸；生产注册失败不影响 React 启动，开发不注册；HTML 关联 manifest、图标及独立窗口视口元数据。
- [x] GREEN：重跑 HTTP 测试；真实浏览器验证离线启动与 cache 枚举（无 API/私人数据），其他路径哨兵缓存保留；新增两个版本的更新及下载失败测试，不能以内部 mock 替代 worker。
- [x] Checkpoint：与 Task 2 一起完成运行代码的完整必需门槛后提交，避免未完成的跨模块功能提前提交。

### Task 2：显式离线游客与身份保持

**Files:** 修改 `src/client/App.tsx`、`src/client/styles.css`、`tests/e2e/pwa.spec.ts`。

**Acceptance:** 冷启动离线和已登录断网均不静默开始，主动选择游客才开始；会话不撤销；恢复联网不补传；在线开局断网仍手动重试。

- [x] RED：真实页面完成缓存后离线重开，进入准备页，断言出现“以游客身份练习”，正常开始不绕过验证；原版应失败。再覆盖登录后断网开局，不得清 Cookie 或自动开始。
- [x] 实施：App 保留网络错误状态并在 online/focus 时刷新身份；Training 普通开始重新确认身份，网络错误提供显式游客动作，游客 owner 固定 null。401 与其他业务错误保持原有处理，正常在线游客仍按现有流程练习。
- [x] 安全区：仅对外壳、主内容、登录模态补齐 viewport-fit 与四边安全区；保留缩放、原触摸反馈和后台作废。
- [x] GREEN：游客完成并恢复联网后无成绩 POST；已有会话继续可验证；在线开局后断网结果可手动重试一次落库；既有跨账号、过期会话与 native CDP 作废测试保持通过。
- [x] Checkpoint：执行完整验证序列与安全 diff 审查后，只提交本任务代码/测试/图标，不混入根目录未跟踪技能文件。

### Task 3：验收、知识同步与 Git 收尾

**Files:** 更新 `README.md`、`docs/wiki/architecture.md`、`docs/wiki/operations.md`；新建 `docs/verification/pwa-support.md`；更新本计划复选框。

- [x] 完整门槛：依次运行 typecheck/build/test/e2e，同一构建再跑前缀 e2e；记录实际结果与 RED 信号。构建不得与运行时测试并行，数据库仅使用隔离测试路径。
- [x] 两版本验收：独立测试服务提供真实生成的发行版本，检查多页等待、关完后激活、新版资源失败/摘要不符不影响旧版及正常条件下重试；其他应用缓存哨兵不被删除。
- [ ] 实际平台：记录桌面实际安装/独立窗口、Android 与 iPhone/iPad 真机安装/安全区/后台行为；缺少的证据明确标记未验证，任务不报告全面完成。
- [x] 使用 wiki/write-doc 流程同步已验证机制；README 说明安装菜单、预先缓存、离线不保存和关闭全部窗口更新。验收记录只含本地或保留示例，不写真实入口和凭据。
- [x] 安全审查：status/stat/实际 diff/文件清单，按认证、数据访问、浏览器暴露、网络部署、凭据文档、依赖与测试逐项检查；输出 Findings/Verification/Residual Risk。
- [x] Git finalize：按用户于 2026-11-13 的明确收尾指令合入主干并推送，核对远端 SHA 后清理 feature 分支/worktree；保留实际安装和真机未验收的记录，不改变验收结论。

## 执行记录

- 2026-11-13：继承 prepare；分支 `feature/pwa-support`，worktree `.worktree/feature-pwa-support`。spec 批准 checkpoint `977788d`。根目录既有 `.agents/`、`.claude/`、`.skill-source-lock.json` 不属本任务。

- 2026-11-13：HTTP RED 三项因 manifest 缺失/错误 SPA 回退失败，GREEN 三项通过；离线显式游客 RED 按缺少按钮失败，两个离线用例 GREEN。真实两版本的多窗口等待、未保存结果保护与损坏资源回退通过。存储配额 1 字节的安装失败/恢复通过；缓存读取故障的实际 HTTP 回退 RED/GREEN 通过。
- 2026-11-13：补充 Dockerfile 对构建 helper 的 COPY，并排除 worktree/本地代理配置；初版镜像构建与隔离持久化验收通过，最后 worker 回退改动后重新构建确认。测试增加 scripts/prepare-pwa-verification.ts、tests/e2e/pwa-server.ts、tests/pwa-worker.test.ts，图标可由 scripts/generate-pwa-icons.mjs 复现。

- 2026-11-13：最终序列 typecheck、build、42 项 Node 测试、根路径 16 项 e2e、同一构建前缀路径 16 项 e2e 均通过。新增故障用例覆盖资源 HTTP 503 与错版 HTML；既有完整门槛保留。Edge 针对性 2 项通过，最终 Docker 镜像及隔离持久化验收通过。实际 OS 安装和手机真机仍未验证，保留平台验收项。

- 2026-11-13：代码 checkpoint a12d2a6（feat: add installable PWA and explicit offline practice）。36 个本地文档链接检查、Prettier、仓库默认行尾规则下的 git diff --check、敏感地址和凭据扫描通过；扫描未发现新增私有地址、凭据或运行时产物。图标与离线移动模拟视口截图已检查。平台真机项仍未完成，Git 以 awaiting_review 收尾，不报告全面完成。

- 2026-11-13：用户明确要求合并到主干并推送、清理 work branch。main 快进合入 d998dd3 并推送，远端 SHA 核对一致；任务本地/远端分支和 worktree 已清理，根目录原有未跟踪配置保持不变。本次仅更新收尾文档，复用既有运行代码验证；实际安装与真机验收仍未完成。
