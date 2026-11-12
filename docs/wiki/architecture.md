> 摘要：BrainGym 的前后端模块、身份边界与私人训练记录的数据流。

# 架构与数据边界

BrainGym 使用 React 和 Vite 构建浏览器界面，Fastify 在生产环境同时提供页面和同源 API。SQLite 文件保存用户、凭据摘要、会话和对局汇总，无需独立数据库服务。

| 模块 | 职责 |
| --- | --- |
| `src/client/App.tsx` | 合集入口、训练、结果、登录与个人记录页面 |
| `src/client/game.ts` | 按单调时间推进的内存对局，输入去重与作废 |
| `src/shared/rules.ts` | 随机出题、汇总校验与平衡准确率 |
| `src/shared/contracts.ts` | 前后端共享的数据类型、游戏标识和规则版本 |
| `src/server/app.ts` | Cookie 鉴权、来源校验、API、静态页面 |
| `src/server/store.ts` | SQLite 初始化、事务、凭据与数据访问 |
| `src/server/cli.ts` | 用户创建与 Token 发放、换发和吊销 |

个人 Token 换取固定 7 天的会话。Token 与会话均使用 32 字节安全随机值，数据库只保存 SHA-256 摘要。Cookie 为 HttpOnly、SameSite=Strict，Secure 属性由运行配置控制，线上 HTTPS 部署须设置 `COOKIE_SECURE=true`。登录每个 IP 每分钟最多 20 次；所有写接口要求 Origin 与 `APP_ORIGIN` 一致。API 响应不缓存，服务日志不记录请求正文、Cookie 或凭据。

已登录用户开局前，客户端取得当前用户标识，上传结果时携带 `startedByUserId`。服务端先与有效会话用户比较，再按会话用户写入；该字段只是前置条件，不能用来授予身份。另一个标签页切换账户后，原结果必须由开局用户重新登录并重试。

成绩保存按 `(user_id, result_id)` 唯一约束，在事务中比较已有内容。相同请求返回原记录，不同内容返回 409；分数由服务端根据四类次数复算。客户端完成时间 `completedAt` 与服务端首次落库时间 `receivedAt` 分开保存，重试不改写。历史按完成时间倒序稳定分页，每页 20 条；最佳按游戏、规则版本、N 值分组并使用未舍入分数。

浏览器负责出题和统计，服务端不验证实际游玩过程。数据库不保存题目序列或逐步操作日志，客户端不建立持久化离线队列。游客结果留在当前页面，不能在登录后补传。

来源：[API](../../src/server/app.ts)、[存储](../../src/server/store.ts)、[游戏引擎](../../src/client/game.ts)、[规则](n-back.md)、[运维](operations.md)。SQLite 使用 Node 内置模块，其 API 参考为 [Node.js SQLite 文档](https://nodejs.org/api/sqlite.html)。
