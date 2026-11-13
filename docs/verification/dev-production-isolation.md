# 开发与正式环境隔离验收

日期：2026-11-13。依据：[已批准 spec](../scope/2026-11-13-dev-production-isolation.md)及[实施计划](../plans/2026-11-13-dev-production-isolation/plan-dev-production-isolation.md)。

## 当前结论

核心实现、工作区验证和提交快照的候选演练均已通过；正式迁移尚未执行，整个任务未完成。现役 WheelMaker 仍使用原仓库程序；`D:\Apps\BrainGym` 是待迁移的正式目标目录。没有停止正式服务、替换正式程序或修改正式数据库。

正式控制需要现有 Registry 认证。本机私有配置尚未提供该认证，已请求在未跟踪的 `.env.production.local` 中配置 `BRAINGYM_REGISTRY_TOKEN`，不通过聊天传递凭据。这个缺口不影响代码及隔离验收。

## 已取得的证据

- 环境配置最初 5 项断言因原行为失败；实现后通过。临时目录联接和临时 Git 提交中的符号链接均被拒绝，未创建越界数据库。普通开发 API、预览和 CLI 使用 `.runtime/development/`，端口默认 3002/5173；开发库越界、误用 3001、模式冲突和未指定测试库均拒绝。
- 发布入口最初不存在，对应命令验收失败；实现后 help 和缺失候选的拒绝验证通过，后者不访问私有 Hub。临时 Git 仓库验证 main 限制、未提交源码拒绝及文档/本地元数据的边界；篡改程序、依赖、额外文件及不完整证据均拒绝。
- 发布状态机、候选与环境回归共 28 项，在 `npm test` 中通过。包括真实文件内容恢复、Stop 回复丢失、新版启动失败、就绪超时、原本停止、恢复失败后拒绝覆盖、并发锁，以及发布进程被终止后依据持久日志恢复；数据库内容没有回滚。
- `node --import tsx --test tests/release-hub.test.ts`：5 项通过。使用真实 Windows 文件句柄证明配置可读但不能写入或替换，使用真实 SQLite 连接证明打开的数据库不能作离线备份，关闭后完整目录可备份；原子替换保留旧字节及访问权限。重复保护目录曾复现所有权权限异常，修正为仅持久化访问规则后，同一回归通过。
- `npm run verify:release`：真实隔离 Registry、Hub 和 Gateway 验收通过。证明 Stop 后数据库备份失败能恢复旧服务、正常迁移保留旧 Token/会话/历史、新成绩可保存、退出后旧会话失效、失败发布恢复旧程序字节。其它应用待加载新增、删除、参数变更、待重启、基线缺失及文件保护冲突均在目标 Stop 前拒绝；非目标实例未变。无 Reload 的发布不会覆盖已加载配置基线。

隔离登录兼容验证通过直接回环请求提供可信的单值转发头；业务读取、成绩写入及退出经过隔离 Gateway。该 localhost Gateway 不能证明正式公网登录的客户端 IP 清洗，不将两者混为同一证据。所有测试身份、数据库、端口和服务定义均独立于正式实例。

## 最终验证

环境为 Windows、Node.js v26.12.0、npm 11.20.0。工作区依次完成以下检查，构建与读取该构建的测试没有并行执行：

| 命令                                                                           | 结果                                                                    |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| `npm run typecheck`                                                            | 通过                                                                    |
| `npm run build`                                                                | 通过，Vite 及 NodeNext 输出成功                                         |
| `npm test`                                                                     | 76 项通过，无跳过                                                       |
| `npm run test:e2e`                                                             | 根路径 16 项通过                                                        |
| 设置 `E2E_BASE_PATH=/braingym/` 后 `npm run test:e2e`                          | 同一构建 16 项通过，完成后清除变量                                      |
| `node scripts/verify-development.mjs`                                          | 真实 Vite 代理、登录、完整对局上传、历史及退出通过                      |
| `npm run verify:release`                                                       | 真实隔离 Hub 发布、拒绝及恢复场景通过                                   |
| `docker --config <本机配置目录> build -t braingym:verify-isolation-20261113 .` | 独立镜像构建通过                                                        |
| `scripts/verify-docker.ps1 -Image braingym:verify-isolation-20261113`          | 页面、CLI、登录、计分、幂等及容器重建后数据保留通过；专用容器和卷已清理 |

首次快照演练因继承 `NODE_ENV=test` 生成 React 开发版，PWA 浏览器测试按预期失败，未生成可发布证据。构建入口现固定 production，浏览器验收的更新版本也按 production 构建；以 `NODE_ENV=test` 再次运行构建后，产物与普通生产构建一致。

本机浏览器检查使用已安装 Chrome。发行的 CSS/JS 内容名分别为 `index-CCoYB9Fk.css` 和 `index-Kt4qGQ_7.js`，没有为前缀路径重新构建。

## 代码阶段交付

实现 checkpoint 为 `7116236`，构建环境修正为 `70ed2b5`。`npm run rehearse` 对 `70ed2b5` 的 Git 导出快照完成了全部 8 类检查，退出码 0，并生成完整证据：源码/锁文件/运行环境/全部产物摘要均可重验。候选及私有机器结果位于稳定主工作区 `.runtime/releases/`，不依赖功能 worktree。运行包仅含程序、生产依赖、包清单及发行标记；真实隔离服务已退出，测试账号与数据库已清理。

主工作区原有的 `.agents/`、`.claude/` 和本机技能锁文件保留，按本次源码忽略边界加入本机 exclude；未提交这些文件。代码阶段将按已批准顺序先推送功能分支、合入并推送 main，再从稳定 main 进入迁移阶段；源码合入不触发发布。

## Findings

未发现本次变更新增的阻塞性安全缺陷。以下为非阻塞的既有依赖风险；正式迁移因缺少控制认证未开始，整体验收未通过。

- **P2，既有依赖告警**：[package.json:26](../../package.json#L26)、[src/server/app.ts:164](../../src/server/app.ts#L164)。官方 npm 审计报告 1 high、2 moderate，涉及 `@fastify/static`、`glob`、`minimatch`，锁文件及依赖版本本次未变。两项静态服务告警依赖受保护的静态文件及路径过滤：当前 `dist/client` 全是公开资源，私人数据只经带会话授权的 API 返回，不使用 `allowedPath` 或路由守卫保护静态文件。6 个非规范路径检查返回 401/404，没有读取静态根目录外的隔离哨兵文件。该结论依赖公开静态目录边界，未来改变边界需重新评估。[维护者路径过滤公告](https://github.com/fastify/fastify-static/security/advisories/GHSA-8pvw-jcv7-9cmj)、[维护者路由守卫公告](https://github.com/fastify/fastify-static/security/advisories/GHSA-83w8-p2f5-377r)。
- **P2，间接依赖的潜在资源消耗**：当前 static 插件使用默认 wildcard 分支，不执行 `glob` 扫描；项目不接受外部 glob 模式，也不依赖 AbortSignal 约束 glob 遍历。因此没有发现从请求触达这两项告警的路径。审计提出的修复包含 static 主版本升级，本任务没有未经评估直接升级。[glob 维护者公告](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4)、[minimatch 维护者公告](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)。

## Verification

`git status --short`、`git diff --stat`、实际 diff 及新增文件均纳入审查。检查覆盖环境/数据库隔离、会话和成绩原合同、浏览器凭据、回环绑定、单应用控制、全局 Reload、配置 ACL、输入路径、备份和恢复及镜像输入。6 个 Markdown 文件的相对文件链接无缺失；`git diff --check` 通过。将私有 Hub 中的真实入口和凭据与本次 42 个文件在本机比对，命中为 0；没有运行数据、私有环境文件、依赖或构建输入 Git。

`npm audit --json --cache .npm-cache --fetch-retries=0` 因当前镜像不提供审计接口返回 404。改用 `npm audit --json --registry=https://registry.npmjs.org --cache .npm-cache --fetch-retries=0` 后取得上述 3 项报告，退出码 1；未把非零结果标为无告警通过。隔离结果不替代正式 HTTPS、真实配置、进程归属及数据库保留核验。

## Residual Risk

正式迁移、真实 HTTPS 入口安全头及浏览器、迁移后开发构建不影响正式资源，均未验证。正式数据库只允许迁移备份及只读保留核验；登录和写入回归使用隔离库。恢复日志、完整备份与原始机器报告仅保存在受保护的忽略目录，不进入 Git。
