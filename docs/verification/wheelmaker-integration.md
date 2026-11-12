# WheelMaker 接入验收记录

隐私说明：本文保留当时的验收结果，域名已替换为保留示例，不代表示例地址经过公网验收。两张含真实入口的 Monitor 截图已移出跟踪文件，原件仅保留在本机忽略目录 `data/security-audit/private-screenshots/`；历史暴露范围见[生产入口清理记录](production-entry-cleanup.md)。

验证日期：2026-11-12。依据为[已批准 spec](../scope/2026-11-12-wheelmaker-integration.md)，实现计划见[实施计划](../plans/2026-11-12-wheelmaker-integration/plan-wheelmaker-integration.md)。

运行接入验收通过：正式 Monitor/Forwarding 就绪，Stop/Start、日志和重启后的完整 HTTPS 业务均已核验。验收时 Node 根进程 PID 为 14036，由本机 Hub PID 30908 直接托管，target 为 `http://127.0.0.1:3001`，公网入口为 `https://apps.example.com/braingym/`。用户已批准托管改用 3001，保留占用 3000 的现有 Docker 服务；spec、脚本和正式定义一致。

## 命令与结果

| 检查                                                                  | 实际结果                                                                                               |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 修改前 `npm test`                                                     | 18/18 通过                                                                                             |
| 最终 `npm test`                                                       | 35/35 通过，包含真实 Node 子进程和 Windows named pipe                                                  |
| `npm run typecheck`                                                   | 通过                                                                                                   |
| `npm run build`                                                       | 通过；运行时选择路径，无需为前缀重建                                                                   |
| `npm run test:e2e`                                                    | 根路径 7/7 通过，含原生 CDP 后台中断验证                                                               |
| `E2E_BASE_PATH=/braingym/` 后运行浏览器测试                           | 前缀路径 7/7 通过，使用同一构建                                                                        |
| `node scripts/verify-development.mjs`                                 | 真实 Vite 代理下登录、完整对局保存、历史和退出通过；只为验证覆盖监听及代理端口，保留仓库其余 Vite 配置 |
| `docker --config .docker-local build -t braingym:wheelmaker-verify .` | 通过                                                                                                   |
| `./scripts/verify-docker.ps1 -Image braingym:wheelmaker-verify`       | 静态页面、CLI、登录、服务端计分、容器重建后原 Token/历史及幂等重试通过；专用容器和卷已清理             |
| `node scripts/verify-wheelmaker-isolated.mjs`                         | 隔离的真实 Registry、Hub 与 Gateway AppTunnel worker 上，正常退出和强制终止后均恢复发布                |
| `node scripts/verify-wheelmaker-preflight.mjs`                        | 经正式 Hub IPC 和真实公网 HTTPS 完成旧 Token、旧历史、新成绩、Cookie、退出和转发头清洗预检             |

正式重启验证另执行了 `node scripts/prepare-wheelmaker-verification.mjs --formal-restart`，并在用户完成 Monitor Stop/Start 后执行了 `node scripts/verify-wheelmaker-public.mjs`。停止前的同一 Token、历史及新对局保存通过，临时身份和凭据文件已删除，原有数据指纹不变。这一模式使用本版签发的身份，与升级前凭据验证分开保留结果及截图。

浏览器实际使用已有 Chromium 1217，通过 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定路径。隔离 Hub 验证需要已安装的 WheelMaker 二进制和从 WheelMaker 源码构建的 Gateway 测试 worker；升级前公网预检需要先运行 `prepare-wheelmaker-verification.mjs` 准备旧版临时身份。它们不是普通 `npm test` 的前置条件，不应作为无环境准备的一条命令执行。

一次并行运行 build 和测试时，Vite 清空 `dist/client` 导致子进程读取构建目录失败；随后按顺序执行，完整测试通过。初次公网检查在退出请求完成前读取 Cookie；验证脚本修正为等待退出完成后再读取 Cookie，随后检查通过，应用鉴权逻辑未因此调整。

## Spec 逐项验收

| #   | 验收                                             | 结论与证据                                                                                                                                           |
| --- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | initialize、单次 ready、身份与 requestId、stdout | 子进程、隔离 Hub 及正式 Monitor ready 通过                                                                                                           |
| 2   | 分段、多帧、超长、坏帧及身份错误                 | `managed.test.ts`、`json-lines.test.ts` 通过；含 UTF-8 字节边界和 EOF 残帧                                                                           |
| 3   | 必需资源异常、锁等待与恢复                       | 真实 SQLite 外部锁触发异常与恢复，诊断清除、PID 不变；健康探测未等待默认 5 秒                                                                        |
| 4   | Hub IPC 单独中断                                 | 真实管道断开后同一应用进程保持健康并重新 open，重置版本；通过                                                                                        |
| 5   | 建连、首个完整响应超时及空闲保持                 | 静默与半行响应分别约 5 秒后重试；成功注册静默 5.5 秒不断开；通过                                                                                     |
| 6   | 整个 Hub 正常退出及强制终止后的冷启动            | 真实隔离 Hub 启动新 PID 和 instanceId，均 ready 并重新发布，旧身份与旧历史保留；通过                                                                 |
| 7   | pending/ready、乱序版本、conflict 与非法响应     | 真实 IPC 注册边界测试通过，失败不停止核心业务；只接受匹配的 target 和公网 URL                                                                        |
| 8   | shutdown、EOF、终止与清理                        | 子进程及隔离 Hub 通过；普通进程忽略 stdin EOF；正式 Monitor Stop/Start、端口释放和映射撤销/恢复通过；退出码观察范围见下文                            |
| 9   | 同构建双路径与 API 404                           | HTTP 与两组浏览器测试通过，含无斜杠 308、API 根及未知 API JSON 404、根 API 无别名                                                                    |
| 10  | Cookie 与固定 Origin                             | HTTP 与真实 HTTPS 通过，Cookie 为 Secure/HttpOnly/Strict、Path=/braingym/，退出清除；错误及本机 Origin 被拒绝                                        |
| 11  | 来源独立限流与伪造转发头                         | 两来源额度、等价 IP、普通模式忽略头的测试通过；实际公网两组伪造 XFF 仍消耗同一额度                                                                   |
| 12  | 代理地址不可用时拒绝登录                         | 缺失、重复、多地址、非法、回环及非可信对端返回 503；原 Token 修复后可用、health 无需该头；通过                                                       |
| 13  | 同 Origin 应用和本机信任边界                     | [架构](../wiki/architecture.md#身份与代理信任边界)及[运维](../wiki/operations.md#接入-wheelmaker)记录用户确认前提；路径/Cookie Path 不作为跨应用隔离 |
| 14  | 普通运行、开发代理与 Docker                      | 根路径浏览器、实际 Vite 代理、默认 Docker 健康和数据保留通过                                                                                         |
| 15  | 数据与旧凭据兼容                                 | 升级前旧版 Store 签发的临时 Token 与旧成绩在新版和真实公网可用；原有 1 名用户、1 条成绩指纹不变，schema 保持 1                                       |
| 16  | 正式配置加载、Node PID、日志、Forwarding         | 正式 Reload、Node 7472→14036、Hub 父进程、stderr 日志、target=3001 与 Stop/Start 均通过                                                              |
| 17  | 实际公网完整业务与清理                           | 升级前身份的完整业务预检及正式实例重启后完整业务均通过；两套临时身份均已清理，原数据保留                                                             |
| 18  | 测试、构建、文档与交付一致性                     | 命令结果通过，正式运行及清理已完成；文档按实际证据记录，Git 选择单独收尾                                                                             |

## 真实 Hub 重启证据的范围

隔离测试使用专用状态目录、数据库和测试端口，不重启正式 Hub。已安装 WheelMaker 为 v1.446，实际连接协议为 2.11。Gateway 使用真实 AppTunnel worker，在回环端口接收隧道业务；该项不覆盖生产 Caddy 边缘配置，生产边缘由下方真实公网检查覆盖。

已安装 Hub exe 的 PE 子系统为 GUI，无法接收控制台 Ctrl+C。测试将其二进制复制到忽略目录，仅将副本的 PE 子系统元数据改为 console，再在独立隐藏控制台发送 Ctrl+C，确认退出码为 0。强制终止场景对同一受控副本执行。应用代码和正式安装未修改；这项证据覆盖 Hub 的正常关闭与强制终止恢复，不声称覆盖桌面客户端的退出交互。

| 阶段           | Hub PID | Node PID | instanceId                 | 发布  |
| -------------- | ------- | -------- | -------------------------- | ----- |
| 首次           | 21216   | 34692    | IFJMCY3C4KYSOWQWE4P3N5ZIFQ | ready |
| 正常退出后重启 | 35336   | 35520    | T22C2P2MBW7MB7GVP63YLZH6VQ | ready |
| 强制终止后重启 | 26148   | 34960    | X42HO3JTL5XRBNMVQADP6FYW4R | ready |

三次均沿用测试数据库，升级前身份及历史内容不变。测试结束后仅清理自己启动的服务进程。

## 公网预检与正式实例验收

公网预检通过正式 Hub 的本机 IPC 注册 `braingym`，使用临时验证控制进程，target 为 `http://127.0.0.1:50519`，Node PID 为 9684。浏览器实际访问 `https://apps.example.com/braingym/`，使用升级前签发的 Token 登录、读取旧成绩、完成新对局、读取历史和最佳、退出，并检查资源路径、Cookie 和网关转发头清洗。

验证后已停止临时进程、撤销临时注册，精确删除该验证身份及其从属数据，核对原有数据指纹不变，并删除保存明文 Token 的临时文件。该次预检单独保留，正式实例证据见下文。预检的[结果截图](screenshots/wheelmaker-public.png)仅包含临时账户名和新成绩，无 Token。

端口调整后，用隔离数据库追加验证了 `http://127.0.0.1:3001`。临时 Node PID 为 34128，经过正式 Hub IPC 发布后，实际公网 health、页面和前缀资源均通过；正常退出码为 0，回环端口释放，注册撤销后公网 health 返回 404。最初在普通沙箱内无法连接正式 Hub 管道，使用具备本机管道访问权限的环境后通过。该项仍由临时控制进程执行，不替代正式 Monitor 加载，也未修改正式用户数据。

正式定义已写入当前用户的 `.wheelmaker/config.json`，ID 为 `braingym-process`，使用绝对 Node 路径和本仓库 cwd，沿用 `data/braingym.sqlite`。端口调整前另建了同权限备份；只读对比确认整个配置仅本条 `PORT` 从 3000 变为 3001，公网 Origin 和路径未变，备份与主配置 ACL 相同。仓库不保存完整 Hub 配置、认证材料或正式数据库。

用户手动 Reload 后的客户端截图（含入口原件仅在本机私有保存）显示 Monitor 中 BrainGym ready、PID 7472，Forwarding 中 braingym ready、target 为 3001 且公网 URL 正确。只读进程检查确认 3001 listener 属于直接执行构建入口的 Node PID 7472，父进程为正式 WheelMaker Hub PID 30908。本机及真实 HTTPS health、页面、前缀脚本加载通过，未登录 `/api/me` 返回 401。

为正式 Stop/Start 验收，通过 `prepare-wheelmaker-verification.mjs --formal-restart` 在停止前创建了本版临时身份和历史。该身份用于验证重启保留，与升级前创建并已清理的身份分开记录。

用户确认已 Stop 且未 Start 后，只读核对 PID 7472 已消失、3001 已释放、本机连接被拒绝，实际公网页面与 health 均返回 404，证明映射撤销。原有数据指纹不变，本轮临时凭据与历史仍保留。本次未捕获正式进程退出码；退出码 0 的证据来自真实子进程、隔离 Hub 和临时控制进程测试，不能表述为已观察到正式 Stop 的退出码。

用户 Start 后提供的本应用日志截图（含入口原件仅在本机私有保存）显示两次不同的 instanceId，以及两次正确的 3001 listener 和公网 ready。新 Node PID 为 14036，父进程仍为 Hub PID 30908。真实公网使用停止前的同一 Token 登录、读取原临时历史、完成新对局并保存、读取历史和最佳、检查 Secure Cookie 及退出均通过；转发头清洗和资源路径也通过。[正式实例对局截图](screenshots/wheelmaker-formal-public.png)未包含 Token。

本轮验证已按临时身份精确删除会话、凭据、成绩和用户，凭据文件已删除。原有用户、凭据摘要和成绩指纹保持不变，数据库仍为 schema 1、1 名原有用户、1 条原有成绩。清理后正式 HTTPS health 仍为 200/ok，正式服务保持运行。

桌面启动动作曾被自动审批审查拒绝，原因为 `Computer Use was not approved to use wheelmakerdesktop`。用户随后明确授权打开客户端并完成 BrainGym 的 Reload、Start/Stop 和日志验收；客户端已在运行，但访问其窗口仍被自动审批以相同原因拒绝，Agent 未执行客户端按钮操作，也未绕过限制。正式实例的后续验收通过用户手动操作、截图及只读进程/公网检查完成。

## 测试先行记录

- HTTP：新增 7 项中 5 项在实现前按预期失败，暴露前缀、文档路径、可信 IP、独立额度和真实存储健康缺失；实现后通过。追加 `/braingym/api` 和查询参数断言发现 HTML 回退问题，修正后通过。
- Managed：真实子进程的 stdout 启动横幅首先违反协议断言；改为协议输出与 stderr 日志后，初始化、健康、锁竞争、退出和非法帧 5 项通过。
- Forwarding：真实 Node 已 ready 但未在真实管道发送 open，注册断言失败；接入持续注册后，3 项集成测试通过，覆盖恢复、版本、首包期限和撤销。

原始机器结果位于忽略目录 `data/wheelmaker-verification/`；本页只保留脱敏结论及必要进程证据。复现和部署步骤见[运维文档](../wiki/operations.md)。
