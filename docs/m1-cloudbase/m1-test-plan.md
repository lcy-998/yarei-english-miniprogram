# M1 CloudBase 测试计划

> M1 测试在 M0 退出并由用户允许开发环境操作后执行。截至 2026-09-23，非生产环境预算为 0：数据库集合/客户端权限/关键索引只读核验、全部 16 个业务函数部署、匿名调用拒绝、日志脱敏抽样、虚构种子精确回滚/重导入/verify、四角色认证、跨组织拒绝、撤权旧会话、50 人容量、主闭环、绑定回收、阅读进度幂等写入及 `organization-admin.updateUser` 云端冒烟均有通过记录。管理员会话的事务内并行历史读取已改为顺序读取并部署，虚构管理员 bootstrap 与后台授权读取复测通过。云端付费压测未执行；本地零成本性能基线已加入测试，真实性能专项仍需预算/额度授权。

## 1. 测试层级

| 层级 | 目标 | 环境 |
| --- | --- | --- |
| L0 文档/模板 | JSON、链接、术语、集合/函数映射一致 | 本地，无认证 |
| L1 纯领域 | 状态、时间、快照、版本、点评条件 | 现有 Vitest |
| L2 repository 合约 | memory 与 cloudbase 返回/错误语义一致 | 本地 + M1 开发环境 |
| L3 云函数集成 | 真实身份上下文、事务、索引、规则、审计 | M1 开发/测试环境 |
| L4 小程序回归 | M0 页面不改调用即可完成闭环 | 微信开发者工具 |
| L5 安全/性能 | 越权、并发、弱网、容量与恢复 | 独立 M1 测试环境，需预算确认 |

## 2. 测试数据

- 仅使用虚构组织“启航实验学校”、虚构角色和测试编号。
- 每个测试 run 使用独立 `seedRunId`；失败后也能精确清理。
- 凭据、手机号和平台 subject 使用测试系统安全提供的测试值，不写 fixture、截图或日志。
- 数据集至少覆盖正常、空、失败、无权限、资源下架、已过期、解绑、撤权和版本冲突。

## 3. 权限隔离

必须参数化覆盖 `authorization-rules.md` 的 AUTHZ-01—AUTHZ-14，并增加：

- 未登录/匿名平台身份不能调用业务函数。
- 客户端 SDK 直接读取/写入每个业务集合均失败。
- 学生、家长、教师、管理员跨 organization 查询和写入均失败。
- 列表、详情、聚合统计和分页下一页使用相同授权范围。
- 软删除、停用、撤权、解绑后旧 session 和旧游标立即失效。
- 返回字段 allowlist 不含 password/hash/ciphertext/providerSubject/teacherNote 等不应字段。
- 失败 message、函数日志、审计日志和监控事件不泄露敏感字段。

通过门槛：越权成功数为 0；任何一例泄露或写入均为阻断缺陷。

## 4. 幂等

对 publish task、submit、publish review、batch comment、bind/unbind、管理写操作分别验证：

1. 同 operationId + 同请求串行重试返回同一业务 ID/receipt。
2. 同 operationId + 同请求并发 2/5/10 次只产生一次业务写入。
3. 同 operationId + 不同请求返回 `CONFLICT`。
4. 第一次响应在网络层丢失，重试仍得到第一次结果。
5. 函数超时但事务已提交，重试不会产生重复对象。
6. 幂等记录过期边界按已批准保留策略测试。

通过门槛：任务、assignment、submission version、feedback 和 link 均无重复；审计能关联首次与重试 requestId。

## 5. 事务与并发

| 场景 | 并发行为 | 预期 |
| --- | --- | --- |
| 两位请求同时发布同一草稿 | 相同 expectedVersion | 仅一个成功，另一个 `CONFLICT` |
| 同一学生双击提交 | 不同/相同 operationId | 只产生一个正式版本；不同意图按状态冲突 |
| 保存草稿与正式提交交错 | 旧 draftVersion | 正式提交不被旧草稿覆盖 |
| 两位教师点评同一提交 | 同 submissionVersion | 只产生一个正式 feedback |
| 点评时学生新提交重做版本 | 旧版本 | 点评精确落旧版本或拒绝，不误评新版本 |
| 家长绑定达到 5/学生达到 3 | 并发消费绑定码 | 上限不被突破，码状态一致 |
| 教师发布过程中撤销授权 | 事务内复核 | 发布失败且无半成品 |
| 资源发布前下架 | 发布事务复核 | `RESOURCE_OFFLINE`，无 task/assignment |

同时验证平台事务限制：批准规模内原子成功；超过 OQ-09 上限明确返回 `VALIDATION_ERROR`，不能部分成功。

## 6. 弱网和故障恢复

- 调用前断网：返回 `NETWORK_ERROR`，页面保留输入。
- 请求已到服务端但响应丢失：重试 operationId 返回原结果。
- 云函数短暂不可用：`SERVICE_UNAVAILABLE` 且 retryable=true。
- 数据库事务冲突：有限重试后 `CONFLICT`，不得返回模糊成功。
- 列表刷新失败：保留旧数据和更新时间。
- session 过期：`UNAUTHENTICATED`，回登录；未提交表单按当前页面策略保留。
- 恢复网络后不自动重复发布/提交/点评，除非使用原 operationId 的明确重试。

通过门槛：无输入丢失、无重复写入、无无法解释的半成功。

## 7. M0 → M1 回归

同一组合约测试在 memory 和 cloudbase adapter 上运行：

- 当前 `login/listRoles/getHome/getTaskDetail/listStudentTasks/saveDraft/submitTask` 的成功和错误语义。
- `getTeacherTasks/getCompletion/publishClassroomTask/reviewSubmission` 的角色与数据范围。
- `getParentHome/getParentTask/getParentFeedback` 仅返回 active link 孩子。
- `HomeView/TaskDetailView/ReviewAssignmentView` 页面所需字段稳定；新增服务端字段不强迫页面消费。
- 教师发布 → 学生提交 → 教师人工点评 → 家长查看结果的单一数据源一致。
- M0 的 loading/empty/failure/forbidden 场景仍可用 memory repository 演示。

当前 M0 实现存在的简化（单一学生 assignment、隐式家长孩子关系、较小错误码 union）必须通过 M1 adapter 补齐服务端安全语义，不能把简化复制到云端。

## 8. 数据与索引验证

- 用 explain/平台查询分析确认核心列表命中预期索引，不进行无范围全表扫描。
- 验证唯一约束/确定性 ID：task+student、assignment+submissionVersion、submission+feedback、provider+subject。
- 发布后修改或下架 resource，历史 task snapshot 输出不变。
- 统计从 assignment/submission/feedback 重算，与列表和详情一致。
- 种子导入、重复导入、冲突停止、精确回滚均通过。

## 9. 性能与容量（需预算确认后）

- 普通 API 目标沿用产品 P95 ≤800ms；分别记录函数冷启动与热启动。
- 以批准的班级人数测试发布事务，不自行扩大到生产负载。
- 分页、索引和完成情况聚合使用虚构批量数据。
- 10 万注册/1 万日活/500 峰值并发是产品架构目标，不等于本次可直接发起压测；压测环境、额度和成本必须先由用户批准。

预算为 0 时仅执行 `tests/performance/local-baseline.test.ts` 的本地虚构种子生成/校验基线，不访问 CloudBase、不模拟付费并发；该基线不能替代云端 API P95 验收。

## 10. 发布门槛与报告

M1 接入门槛：

- 四角色隔离、客户端数据库拒绝、关键事务和幂等用例全部通过。
- memory/cloudbase 合约差异为 0，或有明确且经批准的版本说明。
- `npm run typecheck`、`npm test`、`npm run check` 实际通过。
- 微信开发者工具完成 M0 主路径回归，页面没有为 CloudBase 重写。
- 日志脱敏、索引、备份/回滚与预算告警有证据。

报告必须列：日期、环境用途（不暴露 envId）、CLI/SDK/基础库版本、用例通过/失败/跳过数、requestId 示例的脱敏形式、未执行的真机/安全/性能项、残余风险和回滚结果。
