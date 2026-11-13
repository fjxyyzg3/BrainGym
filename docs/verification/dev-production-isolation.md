# 开发与正式环境隔离验收

日期：2026-11-13。依据：[已批准 spec](../scope/2026-11-13-dev-production-isolation.md)及[实施计划](../plans/2026-11-13-dev-production-isolation/plan-dev-production-isolation.md)。

## 当前结论

开发与正式环境分离已完成。WheelMaker 现役程序运行于仓库外 `D:\Apps\BrainGym`，发布状态为 `published / verified`。原 HTTPS Origin、`/braingym/`、3001 回环端口、应用和服务标识保持不变；数据库仍位于原绝对位置，只读指纹核验确认用户、凭据、有效会话与历史均已保留。

代码已完成，工作区验证和 Git 快照候选演练均已通过；先合入并推送 main，再完成正式迁移及在线验收。迁移后在原仓库再次执行构建，正式进程 PID、instanceId、全部程序与生产依赖摘要均未改变，真实页面和资源仍通过检查。

首次发布尝试曾在 Stop 前因缺少独立发布客户端的认证返回 `AUTH_REQUIRED`；该阻塞现已解除。用户将既有 Registry 登录凭据配置到受保护且未跟踪的 `.env.production.local` 后，登录和 Monitor/Forwarding 状态读取成功。该认证只供发布管理工具使用，BrainGym 运行时仍通过 stdio 与本机 IPC 接入 Hub。

## 已取得的证据

- 环境配置最初 5 项断言因原行为失败；实现后通过。临时目录联接和临时 Git 提交中的符号链接均被拒绝，未创建越界数据库。普通开发 API、预览和 CLI 使用 `.runtime/development/`，端口默认 3002/5173；开发库越界、误用 3001、模式冲突和未指定测试库均拒绝。
- 发布入口最初不存在，对应命令验收失败；实现后 help 和缺失候选的拒绝验证通过，后者不访问私有 Hub。临时 Git 仓库验证 main 限制、未提交源码拒绝及文档/本地元数据的边界；篡改程序、依赖、额外文件及不完整证据均拒绝。
- 发布状态机、候选与环境回归共 28 项，在 `npm test` 中通过。包括真实文件内容恢复、Stop 回复丢失、新版启动失败、就绪超时、原本停止、恢复失败后拒绝覆盖、并发锁，以及发布进程被终止后依据持久日志恢复；数据库内容没有回滚。
- `node --import tsx --test tests/release-hub.test.ts`：5 项通过。使用真实 Windows 文件句柄证明配置可读但不能写入或替换，使用真实 SQLite 连接证明打开的数据库不能作离线备份，关闭后完整目录可备份；原子替换保留旧字节及访问权限。重复保护目录曾复现所有权权限异常，修正为仅持久化访问规则后，同一回归通过。
- `npm run verify:release`：真实隔离 Registry、Hub 和 Gateway 验收通过。证明 Stop 后数据库备份失败能恢复旧服务、正常迁移保留旧 Token/会话/历史、新成绩可保存、退出后旧会话失效、失败发布恢复旧程序字节。其它应用待加载新增、删除、参数变更、待重启、基线缺失及文件保护冲突均在目标 Stop 前拒绝；非目标实例未变。无 Reload 的发布不会覆盖已加载配置基线。

隔离登录兼容验证通过直接回环请求提供可信的单值转发头；业务读取、成绩写入及退出经过隔离 Gateway。该 localhost Gateway 不能证明正式公网登录的客户端 IP 清洗，不将两者混为同一证据。所有测试身份、数据库、端口和服务定义均独立于正式实例。

## 最终验证

环境为 Windows、Node.js v26.12.0、npm 11.20.0。工作区依次完成以下检查，构建与读取该构建的测试没有并行执行：

| 命令                                                                           | 结果                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `npm run typecheck`                                                            | 通过                                                                                  |
| `npm run build`                                                                | 通过，Vite 及 NodeNext 输出成功                                                       |
| `npm test`                                                                     | 76 项通过，无跳过                                                                     |
| `npm run test:e2e`                                                             | 根路径 16 项通过                                                                      |
| 设置 `E2E_BASE_PATH=/braingym/` 后 `npm run test:e2e`                          | 同一构建 16 项通过，完成后清除变量                                                    |
| `node scripts/verify-development.mjs`                                          | 真实 Vite 代理、登录、完整对局上传、历史及退出通过                                    |
| `npm run verify:release`                                                       | 真实隔离 Hub 发布、拒绝及恢复场景通过                                                 |
| `docker --config <本机配置目录> build -t braingym:verify-isolation-20261113 .` | 独立镜像构建通过                                                                      |
| `scripts/verify-docker.ps1 -Image braingym:verify-isolation-20261113`          | 页面、CLI、登录、计分、幂等及容器重建后数据保留通过；专用容器、卷及验收镜像标签已清理 |

首次快照演练因继承 `NODE_ENV=test` 生成 React 开发版，PWA 浏览器测试失败，未生成可发布证据。构建入口现固定 production，浏览器验收的更新版本也按 production 构建；以 `NODE_ENV=test` 再次运行构建后，产物与普通生产构建一致。

本机浏览器检查使用已安装 Chrome。发行的 CSS/JS 内容名分别为 `index-CCoYB9Fk.css` 和 `index-Kt4qGQ_7.js`，没有为前缀路径重新构建。

## 代码阶段交付

实现 checkpoint 为 `7116236`，构建环境修正为 `70ed2b5`。`npm run rehearse` 对 `70ed2b5` 的 Git 导出快照完成了全部 8 类检查，退出码 0，并生成完整证据：源码/锁文件/运行环境/全部产物摘要均可重验。候选及私有机器结果位于稳定主工作区 `.runtime/releases/`，不依赖功能 worktree。运行包仅含程序、生产依赖、包清单及发行标记；真实隔离服务已退出，测试账号与数据库已清理。

主工作区原有的 `.agents/`、`.claude/` 和本机技能锁文件保留，按本次源码忽略边界加入本机 exclude；未提交这些文件。功能分支已推送并核对远端 SHA，随后 main 快进到 `b0f3339` 并推送，实际远端 SHA 核对一致。任务分支、本任务 worktree 及无效候选已清理；另一项功能 worktree 保留。已在稳定 main 重新 prepare 迁移阶段，清理 worktree 后候选仍能完成来源和摘要核验，源码合入不触发发布。

## 正式迁移与构建隔离复验

在本地 main 与远端 SHA 一致、工作区干净且候选证据有效时，从稳定 main 工作区执行 `npm run release -- deploy --candidate <有效候选>`，退出码 0；随后 `npm run release -- status` 返回 `published / verified`。候选运行源码来自 `70ed2b5`，main 后续只改文档，运行源码指纹一致，没有重新构建正式运行包。

迁移前真实 Monitor 仅有 BrainGym 一项应用，磁盘定义与 Monitor 集合核对通过，无非目标应用待加载变化；托管 Node 与演练环境一致，备份空间充足。工具仅 Stop/Start BrainGym，停服后备份完整数据库目录及原程序，在受保护的配置替换和全局 Reload 后将 cwd 切到 `D:\Apps\BrainGym`。发布期间没有在正式目录安装依赖或构建，也没有回滚数据库。

迁移后检查确认：

- 正式目录全部 2827 个文件的摘要均与有效候选中的对应摘要一致，只包含程序、生产依赖、包清单及发行标记。
- 新 Node 根进程的直接父进程为 WheelMaker Hub，Monitor 为 `running / healthy`，Forwarding 为 `ready`。
- 数据库绝对位置、原 Origin、基础路径、回环 HOST/PORT、`COOKIE_SECURE=true` 保持不变；迁移前既有用户、凭据、有效会话和结果的指纹在迁移后仍匹配。离线备份也通过同一保留核验。
- 本机及真实 HTTPS 的健康、页面、前缀资源、发行标记、匿名私人接口拒绝和全新 Chrome 加载检查全部通过。未向正式库写入测试身份、测试会话或成绩。

随后在稳定主工作区执行 `npm run build`，退出码 0。复查确认正式目录全部文件摘要及 PID/instanceId 均未变，Monitor/Forwarding、本机及真实 HTTPS 页面和资源、全新浏览器加载检查也均通过。开发构建只更新仓库 dist，没有改变正式程序或进程。

完整备份、已加载配置基线、迁移阶段日志、在线检查及构建前后对照保存在稳定主工作区受保护的 `.runtime/releases/`；有效候选和最近恢复材料保留。原任务 worktree 清理后，发布与验收都从稳定 main 完成。

实际 HTTPS 响应含 CSP、防嵌入、`X-Content-Type-Options` 和 `Referrer-Policy`；未返回 HSTS 或 `Permissions-Policy`。没有声称代理补齐这些策略，也未修改网关。

## Findings

未发现本次变更新增的阻塞性安全缺陷，spec 要求的代码、隔离故障场景、正式迁移与构建隔离验收均已完成。以下既有依赖告警及响应头加固缺口仍然存在。

- **P2，既有依赖告警**：[package.json:26](../../package.json#L26)、[src/server/app.ts:164](../../src/server/app.ts#L164)。官方 npm 审计报告 1 high、2 moderate，涉及 `@fastify/static`、`glob`、`minimatch`，锁文件及依赖版本本次未变。两项静态服务告警依赖受保护的静态文件及路径过滤：当前 `dist/client` 全是公开资源，私人数据只经带会话授权的 API 返回，不使用 `allowedPath` 或路由守卫保护静态文件。6 个非规范路径检查返回 401/404，没有读取静态根目录外的隔离哨兵文件。该结论依赖公开静态目录边界，未来改变边界需重新评估。[维护者路径过滤公告](https://github.com/fastify/fastify-static/security/advisories/GHSA-8pvw-jcv7-9cmj)、[维护者路由守卫公告](https://github.com/fastify/fastify-static/security/advisories/GHSA-83w8-p2f5-377r)。
- **P2，间接依赖的潜在资源消耗**：当前 static 插件使用默认 wildcard 分支，不执行 `glob` 扫描；项目不接受外部 glob 模式，也不依赖 AbortSignal 约束 glob 遍历。因此没有发现从请求触达这两项告警的路径。审计提出的修复包含 static 主版本升级，本任务没有未经评估直接升级。[glob 维护者公告](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4)、[minimatch 维护者公告](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249)。

- **P2，现役 HTTPS 策略加固**：[响应头设置](../../src/server/app.ts#L51)。实际入口未观察到 HSTS 与 `Permissions-Policy`；此为原入口的已核实缺口，不属于本次新增回归。

## Verification

`git status --short`、`git diff --stat`、实际 diff 及新增文件均纳入审查。检查覆盖环境/数据库隔离、会话和成绩原合同、浏览器凭据、回环绑定、单应用控制、全局 Reload、配置 ACL、输入路径、备份和恢复及镜像输入。7 个 Markdown 文件的相对文件链接无缺失；`git diff --check` 通过。将私有 Hub 中的真实入口和凭据与本次 43 个文件在本机比对，命中为 0；没有运行数据、私有环境文件、依赖或构建输入 Git。

`npm audit --json --cache .npm-cache --fetch-retries=0` 因当前镜像不提供审计接口返回 404。改用 `npm audit --json --registry=https://registry.npmjs.org --cache .npm-cache --fetch-retries=0` 后取得上述 3 项报告，退出码 1；未把非零结果标为无告警通过。隔离结果不替代正式 HTTPS、真实配置、进程归属及数据库保留核验。

## Residual Risk

正式环境未执行登录或成绩写入测试；这些业务回归使用隔离数据库。对正式库仅执行了本次迁移所需的完整离线备份与只读保留核验。既有依赖告警、HSTS 和 `Permissions-Policy` 缺口仍在；既有同 Origin 信任及代理边界没有改变。恢复日志、完整备份、原始机器报告及 Registry 凭据仅保存在受保护的忽略位置，不进入 Git。
