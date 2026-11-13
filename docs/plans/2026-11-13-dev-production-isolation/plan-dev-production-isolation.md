# 开发与正式环境隔离 Implementation Plan

> **For agentic workers:** REQUIRED SKILL: Use implement to execute this plan task-by-task. Respect the handed-off git_state: inherit prepared, otherwise prepare; use git-workflow for checkpoint/finalize. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 日常开发与正式程序、数据隔离；验证后的 main 版本可显式发布，并在失败时恢复原服务。

**Scope Source:** [已批准 spec](../../scope/2026-11-13-dev-production-isolation.md)

**Architecture:** 服务端环境解析同时供 API、CLI 和开发代理使用。发布工具在独立候选目录校验源码与运行包，以持久日志、目标锁、受保护配置和单应用控制完成切换；定义不变不 Reload，需要重载时先证明全局影响受控。代码阶段先合入并推送 main，随后在稳定 main 工作区完成真实迁移及最后文档记录。

**Tech Stack:** Node.js 24+、TypeScript/ESM、npm、Vite、Fastify、SQLite、WheelMaker、Windows PowerShell。

**Verification:** 针对性 Node 测试；依次执行 `npm run typecheck`、`npm run build`、`npm test`、根路径及 `/braingym/` 的 `npm run test:e2e`；Vite 实际演练、候选运行包检查、隔离真实 Hub 故障恢复、实际 HTTPS 只读验收。

---

## Git 与运行环境

- 已继承 prepare：`feat/dev-production-isolation`，工作区位于主仓库 `.worktree/feat/dev-production-isolation`，初始基线 `a09c049`。
- 主工作区原有 `.agents/`、`.claude/`、`.skill-source-lock.json` 不属于本任务；另一项功能 worktree 保留。只暂存本任务文件。
- 本次批准覆盖代码阶段提前合入 main；迁移未通过不能报告整体完成。稳定 main 中写入最终记录前重新 prepare，候选与私有记录不依赖任务 worktree。
- 正式配置目前只含 BrainGym 一项应用，数据库为主仓库原 `data/braingym.sqlite`；只读脱敏核对已完成，尚未控制或更改正式实例。

## Task 1：独立开发配置与入口

**Files:** 创建 `src/server/environment.ts`、`scripts/development.ts`、`tests/environment.test.ts`；修改 `src/server/config.ts`、`src/server/cli.ts`、`vite.config.ts`、`package.json`、隔离测试启动配置和忽略规则。

**Acceptance:** 开发 API 默认回环 3002、Vite 默认 5173，开发库位于当前工作区 `.runtime/development/`；正式管理必须显式选择并指向已部署程序，测试数据库独立。保留 Docker 显式数据库与生产启动配置。

- [x] 先基于现有 `readConfig`/真实 CLI 添加默认开发库、误指旧正式路径、模式冲突、代理端口和测试配置的失败断言，记录 RED：`node --import tsx --test tests/environment.test.ts`，5 项均因旧行为断言失败。
- [x] 实现 `BRAINGYM_ENV` 环境选择及路径校验；开发入口加载未跟踪 `.env.development.local`，正式配置不进入开发进程；CLI 的环境诊断写 stderr，stdout 保持 JSON。
- [x] 让 Vite serve 与 API 使用同一开发设置，构建仍输出当前工作区 dist，不访问正式目录。
- [x] 更新 CLI/进程/e2e fixture 显式选择 test；环境与 CLI 针对性验证 6 项 GREEN，typecheck 通过；托管及浏览器回归纳入最终串行验证。
- [ ] 按最终改动面完成必需验证后 checkpoint。

## Task 2：候选、来源与有效验收证据

**Files:** 创建 `scripts/release.ts`、`scripts/release/artifact.ts`、`scripts/release/paths.ts`、`scripts/release/process.ts`、`tests/release-artifact.test.ts`；调整浏览器测试启动以支持独立运行包。

**Acceptance:** 可单独演练；正式候选仅取已提交 main 内容，产物和依赖可核验。源变化、篡改、路径交叉、符号链接及失效证据在 Stop 前拒绝。正式运行包不含源码、数据库、私有配置或开发依赖。

- [x] 使用临时 Git 仓库与真实目录建立来源、打包白名单和摘要篡改断言；通过现有 npm 入口证明发布命令尚不可用的 RED。
- [x] 实现候选快照、锁文件安装、构建与检查执行、内容/运行环境摘要及证据；有效证据复用，过期则重新验证。
- [x] 实现规范路径、不跟随链接、目标所有权、生产目录与数据目录分离检查，以及稳定私有发布工作目录。
- [ ] 用同一候选执行根路径和前缀浏览器测试；验证生产依赖包及已有 Token/会话在隔离库中的兼容。
- [ ] 运行针对性验证并记录 GREEN；按最终改动面完成必需验证后 checkpoint。

## Task 3：发布状态机、Hub 控制与保护

**Files:** 创建 `scripts/release/deploy.ts`、`scripts/release/hub.ts`、`scripts/release/files.ts`、`scripts/release-windows.ps1`、`tests/release-deploy.test.ts`、`tests/release-hub.test.ts`；修改 `scripts/configure-wheelmaker.ps1`。

**Acceptance:** 发出 Stop 前持久记录恢复责任；备份失败自动恢复原运行状态，部分替换可恢复程序；不回滚数据库。定义未变不 Reload，变更定义必须有全局基线与配置保护，不能修改其它应用。

- [x] 阅读真实 Hub action、Reload、Stop 语义和测试反模式后，以真实文件系统和最小 Hub 控制边界建立失败场景；缺失的切换与恢复行为必须先出现 RED。
- [x] 实现目标锁、原状态/阶段日志、旧程序与完整数据库目录备份、可重复识别的失败恢复；中断或恢复失败保留现场并拒绝后续覆盖。
- [x] 实现认证控制客户端、目标 PID/端口及 Forwarding 核对；只读 HTTP/HTTPS 检查验证页面、资源、发行标记、匿名拒绝及安全头。
- [x] 实现全局 Reload 基线比较；Windows 原子配置替换、ACL 保留、允许 Hub 读取而拒绝外部修改的保护；原已加载定义与磁盘写入分别记录。
- [x] 故障注入覆盖 Stop 回复丢失、停服后两类备份失败、写入进程冲突、磁盘/配置冲突、部分程序替换、启动/检查/恢复失败及并发发布；核对真实程序内容、数据保留和服务状态后记录 GREEN。
- [x] 现有配置脚本改为显式正式目录入口，不允许日常调用重新指向仓库 dist；验证旧定义的受控迁移而非误覆盖。

## Task 4：隔离真实运行与业务回归

**Files:** 创建 `scripts/verify-release-isolated.ts`；按需提取或复用 `scripts/verify-wheelmaker-isolated.mjs` 中的隔离启动与所有权检查；测试资源只位于忽略目录。

**Acceptance:** 真实隔离 Hub 验证 Stop 后备份失败恢复、正常迁移与失败回退；其它应用待加载变更在正式 Stop 前拒绝。旧 Token、会话、成绩在隔离数据库中兼容。

- [x] 使用安装的 Hub/Gateway 与专用 Registry/状态目录，不触及正式 Forwarding，确保临时进程可归属并可清理。
- [x] 让发布模块驱动真实 Stop/Start/Reload，分别验证备份失败恢复和程序替换失败恢复，保留脱敏结果。
- [x] 在其它应用新增、删除、定义修改、待重启和基线缺失时验证拒绝，正常重载验证非目标实例未改变。
- [x] 执行真实 Vite 代理演练与隔离身份兼容验证；输出成功状态而非凭据或私有入口。

## Task 5：文档、全套验证与代码阶段交付

**Files:** 修改 `README.md`、`.env.example`、`AGENTS.md`、`docs/wiki/operations.md`、`docs/wiki/architecture.md`；创建 `docs/verification/dev-production-isolation.md`。

- [x] 记录开发、演练、发布、正式 CLI、两阶段 Git、Reload 基线、失败恢复、数据库备份及本机私有证据位置；wiki 按实际代码同步。
- [ ] 依次通过 `npm run typecheck`、`npm run build`、`npm test`、`npm run test:e2e`；设置 `E2E_BASE_PATH=/braingym/` 对同一构建再跑 e2e 并清除配置。
- [x] 执行依赖审计及认证/数据/浏览器/网络/凭据/打包输入审查，记录实际结果，确认 tracked diff 不含私有值与运行数据。
- [ ] checkpoint 当前已验证代码与证据，刷新远端、同步、推送功能分支、合入并推送 main，核对实际远端 SHA；不把此阶段称为整体完成。

## Task 6：实际迁移与最终收尾

**Files:** 稳定 main 上的本计划、验收文档及按实际结果需修正的 Wiki；`D:\Apps\BrainGym`、原数据库及私有 Hub 配置仅由已验证发布工具在授权范围操作。

- [ ] 切换到稳定 main 并建立该阶段 Git 上下文，确认已批准契约与私有候选/备份不依赖已清理 worktree。
- [ ] 固定 main 候选、核验全部证据，读取正式配置与 Monitor 状态；任何基线、权限或冻结条件不足时在 Stop 前退出，不虚报迁移成功。
- [ ] 显式发布到固定正式目录，保持原数据库、入口及标识；迁移前后仅对正式数据做只读指纹核验，验证真实 HTTPS 与单应用进程归属。
- [ ] 在开发工作区再次构建，验证正式程序摘要、页面和资源未变；发布失败按持久状态恢复并报告。
- [ ] 更新最终验收结果与本计划，Git finalize 提交/同步/推送并核对 SHA；清理仅本任务拥有的干净分支和 worktree，保留最近恢复材料及其他任务文件。
