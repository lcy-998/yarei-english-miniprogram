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

本目录 `templates/development-seed.example.json` 是最小单学生闭环示例。正式 M1 测试种子应另生成权威文档统一演示规模：三年级 2 班 36 人、四年级 1 班 32 人、既有任务 27 人已提交/9 人未提交/6 人待点评。所有新增学生使用“测试学生01”等明确虚构名称，标识不含姓名/手机号。

## 3. 转换规则

| M0 字段/对象 | 转换 | 不迁移 |
| --- | --- | --- |
| `users[]` | 拆成 `users`、`auth_identities`、`role_assignments`、`class_memberships/teacher_class_grants` | 登录手机号、密码、token、session |
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
5. 计算规范化 contentHash；创建 `migration_runs` 的 planned 记录。
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

## 6. 对账断言

- 每个 active role assignment 都指向存在且 active/允许状态的 user 与 organization。
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

## 8. 清理策略

- 例行测试优先“每次创建独立 seedRunId + 测试后精确回滚”，不共享可变 fixture。
- 过期 binding code、idempotency record、草稿和日志的 TTL/定时清理在 OQ-10 决定前只设计不启用。
- 生产真实数据迁移不复用本流程；必须另做字段映射、同意/合规、停机窗口、备份与回退评审。

## 9. 回退 M0

M1 联调失败时，通过 repository 工厂切回 memory 实现。CloudBase 数据不回灌 `mock-state.ts`，也不要求修改 M0 页面；M0 继续使用原虚构状态树。
