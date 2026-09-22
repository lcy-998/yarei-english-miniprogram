# M0 内存数据到 M1 开发种子的迁移

> 只适用于经用户确认的 M1 开发/测试环境。禁止对生产环境执行，禁止导入真实学生、家长、教师、手机号、教材、录音或密钥。

## 1. 迁移目标

- 把 M0 的虚构内存闭环转换为 `database-schema.md` 的集合结构。
- 保持页面可见语义：用户、任务、assignment、提交版本和点评结果一致。
- 为 CloudBase repository 合约测试提供可重复、可回滚的数据基线。
- 不把 M0 的演示登录密码、手机号映射或运行时 session 迁入数据库。

## 2. 种子版本

每套种子必须包含：

```ts
interface SeedManifest {
  seedVersion: string
  schemaVersion: number
  source: 'm0-fixture'
  generatedAt: string
  contentHash: string
  expectedCounts: Readonly<Record<string, number>>
}
```

`contentHash` 固定为 `sha256:<64 位小写十六进制>`。计算输入是按对象键名递归排序、保留数组顺序的规范 JSON；计算时排除 `manifest.contentHash` 自身，覆盖其余 manifest 和全部集合文档。示例中的 `RECOMPUTE_BEFORE_IMPORT` 是明确的准备态占位：本地工具会在内存中重算后再严格校验，不修改源文件。

本目录 `templates/development-seed.example.json` 是可直接通过本地 prepare/validate 的最小单学生闭环正例。正式 M1 测试种子应另生成权威文档统一演示规模：三年级 2 班 36 人、四年级 1 班 32 人、既有任务 27 人已提交/9 人未提交/6 人待点评。所有新增学生使用“测试学生01”等明确虚构名称，标识不含姓名/手机号。

权威规模 fixture 由 `workspace/m1-cloudbase/src/seed/authoritative-fixture.ts` 在内存中确定性生成，不维护臃肿的手写 JSON。它固定生成启航实验学校、三年级 2 班 36 人、四年级 1 班 32 人，以及三年级课堂任务的 36 个 assignment、27 份提交、其中 6 份待点评；导出的摘要从底层 membership、assignment、submission 和 feedback 重新统计。生成器只含明确的“测试学生/教师/家长/管理员”虚构名称、fixture UID 摘要占位和 demo 阅读元数据，不含手机号、密码、真实教材或凭据，并继续复用既有 validator 与本地 apply/verify/rollback 核心。

在 `workspace/m1-cloudbase/` 可执行：

```powershell
npm run seed:validate
npm run seed:plan
npm run seed:hash
```

三个命令只读取显式指定的示例 JSON，不读取 `.env.local`，也不初始化 CloudBase SDK。`seed:validate` 校验集合结构、计数、ID、类型化引用、同组织边界、任务/提交/点评指针、敏感字段与疑似手机号/邮箱/凭据；`seed:plan` 只输出依赖顺序、集合计数和身份摘要占位数量；`seed:hash` 只输出规范摘要。它们不提供 import、apply、rollback 或删除能力。

源码另提供纯 TypeScript 的 apply/verify/rollback 领域核心与事务型 repository：apply 会先对所有 `_id` 和内容摘要做整体预检，同 ID 同内容跳过，同 ID 不同内容在任何写入前阻断；`migration_runs` 记录 seedRunId、种子摘要、集合计数和本次实际创建文档的 `_id + collection + 单文档摘要`。verify 只读对账，rollback 只删除本 run 实际创建且摘要、归属均未变化的文档，任一文档缺失或被外部修改即整体停止。该领域核心可由 CloudBase 事务桥注入，但不代表已获得导入授权或已完成真实导入。

`workspace/m1-cloudbase/src/seed/document-database-repository.ts` 已补充 `SeedRepositoryPort → DocumentDatabasePort` 的纯事务适配器与 fake database 合约测试。适配器没有集合清空、通配删除或事务外写入口；业务文档逐 `_id` 创建，每条实际创建记录附 `seedRunId`、`seedVersion` 和单文档摘要，`migration_runs` 只通过同一事务创建或版本替换。调用方必须显式提供单组织边界和已经过平台验证的事务端口操作预算，代码不提供猜测性默认值。

当前权威规模 fixture 共 373 条业务文档；全新 apply 在现有单事务算法下至少需要 748 次文档端口操作（1 次 run 读取、373 次逐 ID 预检、373 次创建和 1 次 run 写入）。当配置预算低于该值时，适配器在首个写入前返回 `CAPACITY_EXCEEDED`，fake 合约验证业务集合和 `migration_runs` 均保持空。这个门禁只计算现有端口调用，不能替代 CloudBase 原生事务操作数、时长、请求大小和查询分页限制的实测；实测预算未确认前不得把 373 条数据当成可原子导入。

`workspace/m1-cloudbase/src/seed/batch-coordinator.ts` 在同一 repository 边界上提供可恢复的分批协调核心。单批最多 25 条且每批使用独立事务；状态依次为 `planned → applying → verifying → succeeded`，异常进入 `failed`，回滚使用 `rolling_back → rolled_back`。每次调用只推进一个持久化状态或一个批次，进程中断后从最后一个已提交批次恢复；全部候选文档和 run 归属集合 verify 完成前不能写成 `succeeded`。这不会把多事务伪装成全局原子操作：中途失败时已完成批次仍存在，但 run 保持 `failed`，读取侧必须屏蔽未成功 run。

导入前的身份占位替换现由 `runtime-identity-materialization.ts` 单独承接：它只接收已经由受保护服务端能力计算好的 `sd1_` 摘要，并要求与权威 fixture 中每个 `userId` 一一对应；原始 UID、手机号、密码、额外字段、缺失/多余/重复绑定和重复摘要都会被拒绝，结果重新计算种子总摘要且不修改输入。validator 与批次协调器默认仍只接受 fixture 占位，只有显式选择 `runtime` 档位才接受运行态摘要。

`cloudbase-account-materializer.ts` 与 `npm run seed:materialize-runtime -- --tcb-cli <本机路径>` 提供只读账号物化入口：它精确核验八个既定虚构账号的唯一性、启用状态和 external/internal 类型，仅在进程内使用 UID 与本机 pepper 计算摘要，并把两份 runtime 包原子写入受 Git 忽略的 `.runtime/cloud-integration/`。输出包和控制台摘要均不包含 UID、密码、手机号、邮箱、环境 ID 或 pepper；该命令不连接数据库、不会导入或回滚数据。

`controlled-operator.ts` 进一步把批次协调器收口为六个单步命令：`status`、`plan`、`advance`、`resume`、`begin_rollback`、`advance_rollback`。它要求明确的非生产 M1、`synthetic-only`、seedRunId、requestId、操作者和 1—25 批大小门禁；不提供自动跑完全程、CLI、SDK、环境读取或原始文档输出。该边界仍只是可注入 repository 的本地代码，不代表获得云端导入授权。

真实云联调不要求为 68 名演示学生逐一创建登录账号。`primary-cloud-integration-fixture.ts` 从 373 条权威包确定性派生独立 run：保留全部 71 个业务用户、角色、班级、任务、36 个 assignment、27 份提交和 21 份已点评记录，只保留学生/家长/教师/管理员四个实际登录 actor 的身份占位，共 306 条文档；派生包使用独立 seedRunId，不改写权威包。`cross-organization-security-fixture.ts` 另生成 17 条、四角色齐全的第二虚构组织安全包，用于跨组织拒绝测试。两包都必须分别物化四条运行态身份摘要、使用独立 migration run 并分别精确回滚。

## 3. 转换规则

| M0 字段/对象 | 转换 | 不迁移 |
| --- | --- | --- |
| `users[]` | 拆成 `users`、`auth_identities`、`role_assignments`、`class_memberships/teacher_class_grants`；每个用户初始化 `authorizationVersion: 1` | 登录手机号、密码、token、session |
| M0 家长隐式取第一个学生 | 显式创建 `parent_student_links` | 任何推断式真实关系 |
| `tasks[]` | 补齐组织、目标、latePolicy、items 快照、审计字段 | 页面缓存/运行时状态 |
| `assignments[]` | 保持 task+student 唯一，补齐组织与版本 | 派生计数缓存 |
| `submissions[]` | 按 assignment/version 导入不可变历史 | 本地未提交临时输入（除明确测试草稿） |
| `feedback[]` | 精确绑定 submission/version，`source=manual` | AI/语音内容 |
| `mock-state` 时间 | 转为服务端接受的确定时间，保留时区语义 | 本机当前时间 |

当前 M0 的 `TaskStatus` 源码未列 `withdrawn/closed`，错误码 union 也较小。转换器只映射现有值；扩展值由 M1 schema 接受，不反向写回 M0 文件。

## 4. 导入前检查

1. 用户已明确环境 ID、地域、计费与操作者，且目标被标记为非生产。
2. 获取目标环境只读清单，确认没有真实数据或不属于本种子的文档。
3. 校验所有输入来自 `mock-state.ts` 或经批准的虚构生成器；扫描手机号、邮箱、密钥格式和未经授权内容。
4. 对 JSON 做 schema 校验、ID 唯一性、引用完整性、时间格式、状态 union 和统计对账。
5. 使用上述本地工具计算并核验规范化 contentHash；只有另行获批的受控 CloudBase 操作器才可创建 `migration_runs` 的 planned 记录。
6. 先应用数据库 deny-all 规则和云函数调用门禁，再允许服务端导入。

任何检查失败即停止，不自动修补真实或未知数据。

## 5. 安全导入步骤

以下是批准后由授权人员执行的流程说明，本任务不执行：

1. 将示例转换为确定性文档数组；每条写入附 `seedRunId` 和 `seedVersion`。
2. 先在 CloudBase Auth 中创建虚构测试用户，再由服务端以实际 CloudBase UID 计算带 pepper 的 subject digest，替换 fixture digest；原始 UID、pepper 和密码不进入种子文件。
3. 按依赖顺序写入：organizations → users/auth identities → roles/classes/relationships → resources → tasks → assignments → submissions → feedback。
4. 每批写入前按 `_id` 检查：不存在则创建；已存在且同 seedVersion/contentHash 则跳过；内容不同则 `CONFLICT`，不覆盖。
5. 对 task/assignment/submission/feedback 聚合使用服务端事务；不得从客户端批量直写。
6. 写入审计日志与 `migration_runs.counts`；日志不含种子正文或凭据。
7. 运行只读对账：引用无孤儿、唯一键无重复、状态与最新指针一致、页面统计可从记录重新计算。
8. 通过后把 migration run 标为 succeeded；失败标为 failed 并进入精确回滚。

### 5.1 大规模种子的批次状态设计门禁

如果 CloudBase 原生事务不能容纳 373 条文档，禁止把多个独立事务包装成“原子导入成功”。当前受控 CloudBase 操作器已采用以下可恢复批次协议；仍须单独评审平台限制和读取隔离后才能获批执行：

1. `migration_runs` 状态至少覆盖 `planned → applying → verifying → succeeded`，失败进入 `failed`，回滚使用 `rolling_back → rolled_back`；运行中记录 `requestId`、当前批次、总批次数和已提交批次摘要。
2. 每批只写确定性 `_id`，提交前记录该批计划，提交后记录实际创建的 `_id + collection + contentHash`；恢复时只能从最后一个完整提交批次继续。
3. 任一批冲突或校验失败立即停止后续批次；在全部 verify 完成前不得把 run 标记为 `succeeded`，也不得向页面暴露为可用基线。
4. 回滚按已提交批次的反向依赖顺序逐批执行；每批删除前重新校验归属与摘要，遇到外部修改即停止并保留现场。
5. 该批次协议会产生可观察的中间状态，不具备全局原子性；只有在测试环境隔离、读取侧屏蔽未成功 run、故障恢复与回滚演练均通过后才可启用。

当前代码实现的是纯 TypeScript 协调核心、受控单步操作器、CloudBase 事务桥与本机临时凭据启动器；运行时种子包只从 Git 忽略目录读取，启动器不接受环境 ID 或长期凭据参数，也没有自动跑完全程的 CLI 命令。合约测试覆盖导入中途事务失败后恢复、verify 完成前不成功、回滚遇到外部修改时停止保留现场、修复后按 `createdDocumentIds` 反向分批精确回滚、runtime 身份摘要必须显式启用且不接收原始身份值，以及首批 CloudBase 事务写入。该实现不构成云端导入授权。

## 6. 对账断言

- 每个 active role assignment 都指向存在且 active/允许状态的 user 与 organization。
- 每个 user 都有大于等于 1 的整数 `authorizationVersion`；角色与教师班级授权变更后的种子不得回退该值。
- 每个 class membership/grant/link 的两端对象存在且同 organization。
- 每个 published task 至少一个 item 快照；资源下架不影响快照读取。
- `(taskId, studentId)` 无重复 assignment。
- `(assignmentId, submission.version)` 无重复且版本连续。
- `latestSubmissionId/latestSubmissionVersion` 指向该 assignment 的最新有效提交。
- 每条 feedback 指向明确 submission/version，M1 每版本最多一个正式反馈。
- 完成、未完成、待检查、待点评统计从底层记录重算后与预期一致。
- 家长只读视图只来自 active link；解绑测试后立即为空/拒绝。

## 7. 回滚

回滚只允许在开发/测试环境，按本次 `seedRunId` 精确执行：

1. 将目标 migration run 标为 rolling_back，停止新的合约测试写入。
2. 只查询带同一 `seedRunId` 的文档，并把 `_id + collection + contentHash` 与 manifest 比对。
3. 若文档被非种子操作修改或被其他 run 引用，停止并报告冲突，不删除。
4. 按反向依赖顺序清理 feedback → submissions → assignments → tasks → resources → relationships/roles → users/classes → organization。
5. 幂等与审计记录不直接删除，记录 rollback 结果；其保留期按 OQ-10。
6. 对账目标集合中该 seedRunId 为零、其他 run 数量不变，再将状态标为 rolled_back。

禁止使用无过滤的集合清空、通配删除或递归删除。回滚失败时保留现场并输出 requestId/冲突 ID，不扩大删除范围。

本地领域核心把成功执行记录为 `succeeded`，成功回滚后保留同一记录并标为 `rolled_back`；同一已回滚 seedRunId 不允许再次 apply，必须使用新的 seedRunId，以免覆盖审计语义。

`DocumentDatabasePort` 适配器现已提供最多 25 条/批的可恢复协调器，持久化 `planned → applying → verifying → succeeded` 和 `rolling_back → rolled_back` 状态；单批失败会记录 `failedFromStatus`、批次游标和安全错误码，显式恢复时从最后完整提交点继续。373 条权威虚构种子必须完成全部候选文档校验和 run 归属集合校验后才可标记 `succeeded`；回滚按 `createdDocumentIds` 逆序分批，任一文档被外部修改时当前批次零删除并保留现场。

该流程是可恢复的多事务流程，不是全局原子事务。实际启用前，所有业务读取必须屏蔽尚未 `succeeded` 的 seed run，且仍需在目标 CloudBase 环境验证单批操作预算和事务证据。当前没有 CLI/云 SDK 导入入口，也没有执行任何云端写入。

## 8. 清理策略

- 例行测试优先“每次创建独立 seedRunId + 测试后精确回滚”，不共享可变 fixture。
- 过期 binding code、idempotency record、草稿和日志的 TTL/定时清理在 OQ-10 决定前只设计不启用。
- 生产真实数据迁移不复用本流程；必须另做字段映射、同意/合规、停机窗口、备份与回退评审。

## 9. 回退 M0

M1 联调失败时，通过 repository 工厂切回 memory 实现。CloudBase 数据不回灌 `mock-state.ts`，也不要求修改 M0 页面；M0 继续使用原虚构状态树。
