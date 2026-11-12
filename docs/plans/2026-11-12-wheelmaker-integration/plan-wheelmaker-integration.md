# WheelMaker Integration Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 使现有 BrainGym 获得 Windows Hub 托管、可靠公网转发与原有数据及运行方式兼容。

**Scope Source:** [已批准 spec](../../scope/2026-11-12-wheelmaker-integration.md)

**Architecture:** 一个 Node 根进程协调 HTTP、SQLite、managed stdio 与独立的持续 IPC 注册。前后端共用运行时基础路径；托管登录仅使用可信回环对端传来的单值客户端 IP，固定公网 Origin 校验保持独立。

**Tech Stack:** Node.js 24+、TypeScript、Fastify、React/Vite、Node SQLite、Node net/crypto、Node test runner、Playwright、现有 WheelMaker 二进制。

**Verification:** `npm test`、`npm run typecheck`、`npm run build`、`npm run test:e2e`、聚焦真实进程/IPC 测试、隔离 Windows Hub 重启、Docker 与真实 HTTPS 验收。

---

Git 继承 scope 的 prepared 上下文：`D:/GithubRepos/BrainGym`、`main`，开始时只有本任务未提交 spec，无其他修改。用户本次选择 C：在当前 main 提交本任务并推送 origin/main。不初始化长期偏好，不创建额外 branch/worktree。

### Task 1: 批准记录与旧版验证基线

**Files:** 本 spec、本 plan；忽略目录 `data/wheelmaker-verification/` 中的旧版身份及前后核对数据。

**Acceptance:** 在覆盖旧构建前，用旧版 Store 创建专用临时身份、保存一条标识明确的历史，保留旧 Token 与既有正式数据的核对基线；不泄露凭据。

- [x] 核对实际 spec、当前用户批准及 prepared Git 上下文，记录批准日期。
- [x] 保存旧版产物与临时身份、历史、既有数据指纹；仅输出成功状态，不输出 Token。旧版基线保留 1 名正式用户和 1 条正式成绩。
- [x] 核对 plan 覆盖全部 18 项验收，文档格式通过；文档 checkpoint 暂不提交，等待本次 Git 选择；原有 18 项测试通过。

### Task 2: 运行时路径、可信 IP 与健康检查

**Files:** 新建 `src/shared/paths.ts`、`src/client/base-path.ts`、`src/server/client-ip.ts`；修改 `src/server/app.ts`、`store.ts`、`src/client/api.ts`、`index.html`、`vite.config.ts`；新建 `tests/integration-http.test.ts`。

**Acceptance:** 同构建支持 `/` 和 `/braingym/`，带前缀 API/静态资源/Cookie/404 正确；不同真实来源额度独立，地址异常返回 503，普通模式不信任转发头；SQLite 锁等待不会耗尽控制期限。

- [x] RED：真实临时 SQLite/Fastify 的新增 7 项测试中 5 项按预期失败：前缀 health 404、HTML 仍根路径、缺 IP 登录成功、用户共享额度、锁定存储仍 healthy。
- [x] RED：覆盖两份 IP 额度、等价 IP、缺失/重复/列表/回环/非法地址及非可信对端；保行为的普通模式与 Origin 测试原已通过。
- [x] 实现路径规范化、带前缀路由及文档注入、相对构建资源与前端 API 拼接；写接口仍固定校验 APP_ORIGIN。
- [x] 实现受限的登录 keyGenerator 与 CLIENT_IP_UNAVAILABLE 响应，不启用泛化 trustProxy；补充 SQLite 短时健康探测、可配置 busy timeout 与幂等 close。
- [x] GREEN：`node --import tsx --test tests/integration-http.test.ts tests/server.test.ts` 共 15 项通过，typecheck/build 通过；checkpoint 尚未提交（本次 Git 选择未返回）。

### Task 3: Managed stdio 与统一生命周期

**Files:** 新建 `src/server/json-lines.ts`、`src/server/managed.ts`、`src/server/config.ts`；重构 `src/server/main.ts`；新建 `tests/managed.test.ts` 及必要测试工具。

**Acceptance:** 真实 Node 进程回显本次身份、仅一次 ready、health 及时且诊断可恢复；shutdown/EOF/信号统一排空并释放资源，普通进程忽略 stdin EOF。

- [x] RED：真实进程因 `BrainGym: ...` 启动横幅出现在 stdout 而触发协议断言失败。
- [x] 实现以 UTF-8 字节限长 8 KiB 的 JSONL 解析及集中输出；初始化前不启动业务，非法字段/身份/版本/帧非零退出并清理。
- [x] 实现资源初始化、周期完整健康事件、HTTP/SQLite 失败与恢复；非托管启动不接管 stdin。
- [x] 实现单次关闭、停止接收请求与有界排空、终止信号处理，15 秒前退出；业务日志全部 stderr。
- [x] GREEN：`node --import tsx --test tests/managed.test.ts` 共 5 项通过，包含锁竞争异常/恢复、PID 保持、EOF/Stop 和普通启动；typecheck 通过。checkpoint 尚无提交授权。

### Task 4: 持续 Forwarding 注册

**Files:** 新建 `src/server/forwarding.ts`，接入 `config.ts`、`main.ts`；新建 `tests/forwarding.test.ts`。

**Acceptance:** 真实 named-pipe 边界上正确 open、接受最新版状态、首包超时和断线重连；转发故障与 managed ready/健康独立；停止后无注册或重连残留。

- [x] RED：真实 Node 进程已 ready，但没有在真实 named pipe 上发送 open，注册行为断言失败。
- [x] 实现状态目录端点 hash、显式回环 HTTP origin 和服务路径一致性校验，5 秒建连与 5 秒首包期限。
- [x] 实现持续响应和状态推送、响应/身份验证、退避重连与成功后无 idle timeout；返回 URL 必须符合已配置公网入口。
- [x] 将注册纳入统一关闭，不将其成功作为 ready 或核心健康条件；注册错误脱敏记录。
- [x] GREEN：`node --import tsx --test tests/forwarding.test.ts` 共 3 项真实管道/Node 集成测试通过；首包静默和半包各 5 秒后恢复，注册后静默超过 5 秒仍保持连接，冲突与坏帧恢复、旧版本忽略、退出撤销均有证据。checkpoint 尚无提交授权。

### Task 5: 部署与端到端验收

**Files:** 新建 `scripts/configure-wheelmaker.ps1`、`prepare-wheelmaker-verification.mjs`、`wheelmaker-rpc.mjs`、`isolated-hub-process.ps1`、`verify-wheelmaker-isolated.mjs`、`verify-wheelmaker-public.mjs`、`verify-wheelmaker-preflight.mjs`、`verify-development.mjs`；修改 `scripts/e2e-setup.ts`、`check-native-visibility.mjs`、`tests/e2e/app.spec.ts`；仓库外仅合并授权的本机 Hub apps 配置。

**Acceptance:** 正常与强制退出的隔离 Hub 冷启动后新实例自动恢复；正式 Hub ready、日志、Start/Stop、Forwarding、真实公网旧 Token/历史与新成绩全部有证据。

- [x] 核对正式 Hub 二进制和 IPC，备份后仅合并 BrainGym 定义，不重启正式 Hub；其他配置不变、定义一条、备份 ACL 相同。发现 Docker `billboard-web-1` 占用 3000 后，用户已选 A：托管改为 3001，公网 URL 不变；不停止现有容器。
- [x] 同步已批准的 3001 到 spec、配置脚本、文档和正式 Hub 定义；同权限备份后只读核对整个配置仅本条 PORT 从 3000 变为 3001。真实临时 Node PID 34128 经正式 Hub IPC 发布，3001 本机及真实 HTTPS health/页面/前缀资源通过；退出码 0，端口与注册释放。使用隔离数据库，不改正式数据；该项仍不替代正式 Monitor 验收。
- [x] 使用独立状态目录、数据库及测试入口验证真实 Windows Hub 正常退出/强制终止后的新 instanceId、相同数据及恢复发布；两次均 ready，旧身份和历史保留。IPC 单独中断由 Task 4 覆盖。GUI Hub 副本仅调整 console 子系统元数据以验证 Ctrl+C，正式安装未修改，证据边界写入验收记录。
- [x] 根路径与前缀浏览器回归各 7/7 通过，同一构建覆盖登录/训练/历史/退出及实际 CDP 后台中断。真实 Vite 代理使用隔离端口验证登录、完整保存和退出通过。
- [x] 完整 `npm test` 35/35、typecheck、build 及最新 Docker 镜像健康/重建保留检查通过。build 与运行时测试顺序执行。
- [x] 用户手动 Reload 后截图确认 Monitor/Forwarding ready；实际 3001 listener 为 Node PID 7472，父进程是正式 Hub PID 30908。真实公网 health、页面、前缀资源和未登录 401 通过，截图已保存。
- [x] 用户确认 BrainGym Stop 且未 Start 后，复核 PID 7472 消失、3001 释放、本机连接拒绝、公网页面与 health 均 404，映射已撤销。只读数据库核对原有记录指纹不变，停止前准备的临时凭据与历史仍在；本次未捕获正式进程退出码，不将其写为已观察到 0。
- [x] 用户 Start 后提供本条日志，确认两次不同 instanceId、正确 listener 和 Forwarding ready；实际新 Node PID 14036，父进程仍为 Hub PID 30908。真实 HTTPS 验证停止前同一 Token/历史、新对局、历史/最佳、Cookie、退出与转发头清洗均通过。临时身份及从属数据和凭据文件已删除，原有数据指纹不变，最终仍为 schema1/用户1/成绩1；正式服务保持运行。旧版升级前凭据证据单独保留。
- [x] 真实 HTTPS 预检核对客户端转发头清洗、升级前身份和旧历史、新训练成绩、Secure Cookie、退出；临时身份和从属数据已精确删除，原有 1 名用户和 1 条成绩指纹不变，明文临时文件已删除。该次由短期控制进程使用正式 Hub IPC 发布，不能代替正式 Monitor 加载验收。
- [x] 外部限制已记录：用户明确授权客户端操作后，运行中的 WheelMaker 窗口访问仍被自动审批拒绝，Agent 未执行客户端按钮操作；用户手动完成按钮操作后，通过截图与只读进程/HTTPS 复核完成验收。3000 冲突已通过用户选择 3001 解决。当时 checkpoint 未提交，最终按本次 Git 选择 C 收尾。

### Task 6: 文档、证据与 Git 收尾

**Files:** 修改 `.env.example`、`README.md`、`docs/wiki/architecture.md`、`docs/wiki/operations.md`；新增 `docs/verification/wheelmaker-integration.md` 及不含凭据的必要证据。

**Acceptance:** 运行入口、信任边界、配置、更新/恢复方式与源码及实际结果一致；每项 spec 验收有实际结论。

- [x] 按 wiki/write-doc 更新两个既定页面及 README/验收记录，完成原稿保存、中文优化、主代理差异核对和独立只读复核；成稿质量与流程执行均通过。记录共享 Origin 与本机信任边界、客户端 IP、双路径和生命周期，Wiki 摘要、相对链接与格式检查通过。
- [x] 逐项写入 18 项验收结果、RED/GREEN 与外部观察，不保存 Token、Hub 认证配置或正式数据库；正式 Monitor 证据及未捕获正式 Stop 退出码的观察边界明确保留。
- [x] 正式加载前曾按 `blocked` 执行阶段性 Git finalize：沿用 main 和原 HEAD `a7e11b2129f1c29a6fe7a5a6a49cca15af0ff6d1`，当时实际 origin/main 同 SHA；任务文件所有权与 diff 已核对。彼时未取得提交/推送选择，保留任务变更和正式配置，未创建分支或 worktree。
- [x] 通过用户操作、截图与只读进程/公网检查完成正式 Reload/PID/日志/StopStart/持续公网确认，完整业务与临时数据清理均通过。
- [x] 最终验收记录完成优化、主代理差异核查、独立只读复核与格式/链接核对；成稿质量和流程执行均通过，18 项运行验收均有组合证据支持。
- [x] 最终 Git finalize 按用户明确选择的 C 执行：在现有 main 提交本任务并推送 origin/main，核对实际远端 SHA 与工作区；提交结果由 Git 历史和最终交付记录，不将动态 SHA 写入本提交。无额外分支或 worktree 需要清理。
