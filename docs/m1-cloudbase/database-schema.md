# M1 CloudBase 数据库设计

> 目标：把 M0 内存状态映射为可持久化的 M1 核心闭环，同时保持现有 service/repository 调用语义。  
> 范围：真实账号与权限的接口位置、学校/班级/用户、家长绑定、课堂任务、提交版本、人工点评、基础阅读/单词、基础后台和审计。M2/M3 对象只保留扩展位，不提前建全量集合。
>
> 索引实测修正（2026-09-13）：CloudBase 将字段集合与方向相同、仅交换主体字段顺序的两个四字段索引判为等价。因此 `teacher_class_grants` 保留 `organizationId + teacherId + status + classId`，班级反向查询使用 `organizationId + classId + status`；`parent_student_links` 保留 `organizationId + parentId + status + studentId`，学生反向查询使用 `organizationId + studentId + status`。不得恢复旧的对称四字段索引设计。

## 1. 建模规则

- 使用 CloudBase 文档型数据库；客户端无直接数据库权限，只有云函数服务端访问。
- 所有业务实体使用不可变字符串 ID，不依赖姓名、手机号、学号或 `_openid` 作为业务主键。
- 服务边界输出带时区的 ISO 8601 字符串；数据库内部时间由服务端生成并使用统一时间类型。
- 所有租户业务文档包含 `organizationId`；客户端传入的组织和角色字段一律忽略，由可信会话解析。
- 任务生命周期、学生任务关系、提交版本、点评结果分别存储，绝不合并为一个 `status`。
- 已发布任务嵌入完整 `items[].resourceSnapshot`；原资源更新或下架不改历史快照。
- 草稿可更新；已提交版本、正式点评和审计日志只追加，不覆盖历史。
- 所有写入携带 `operationId`；可编辑聚合携带 `expectedVersion`。
- 软删除使用 `deletedAt`、`deletedBy`、`deleteReason`；法律/产品保留期确认前不实施自动物理清理。

## 2. 通用字段

除只追加日志外，业务集合使用以下字段：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | 与领域 `id` 相同的不可变业务 ID，便于事务内按文档读取 |
| `organizationId` | string | 租户/学校边界；全局配置对象除外 |
| `schemaVersion` | number | 初始为 `1`，用于迁移 |
| `createdAt` / `updatedAt` | server date | 仅服务端写入 |
| `createdBy` / `updatedBy` | string | 业务用户 ID；系统任务使用固定系统主体 |
| `version` | number | 乐观锁版本；每次可变更新递增 |
| `deletedAt` | server date \| null | 软删除时间 |
| `deletedBy` | string \| null | 执行人 |
| `deleteReason` | string \| null | 安全文案/原因代码，不含敏感正文 |

## 3. M1 集合

### 3.1 `organizations`

最小字段：`_id`、`name`、`status: active|disabled`、`timeZone`、通用字段。M1 默认仍按单学校演示，但保留组织边界，是否支持多学校由 OQ-08 决定。

索引：`status + deletedAt`。

### 3.2 `classes`

最小字段：`_id`、`organizationId`、`name`、`grade`、`term`、`status: active|archived`、通用字段。

不在班级文档嵌入大数组的 `studentIds/teacherIds`；成员与授权独立存储，以避免数组膨胀和并发覆盖。

`classes.version` 同时作为该班有效成员集合的并发 guard。创建成员、转班、停用或恢复 `class_memberships` 时，必须在同一事务内递增受影响班级的 `classes.version`；转班同时递增原班级和目标班级。按班级发布或修改已排期任务时，事务外先解析候选 membership 并记录班级版本，事务内仅按确定性 ID `get` 班级与候选 membership；班级版本变化即返回 `CONFLICT`，不得用旧候选集合生成不完整快照。无需新增独立 guard 集合。

索引：

- `organizationId + status + grade`
- `organizationId + name + deletedAt`（唯一性由服务端事务和可用的唯一索引共同保证）

### 3.3 `users`

最小字段：`_id`、`organizationId`、`displayName`、`displayNameMasked`、`avatarKey?`、`status: active|disabled`、`profileVersion`、`authorizationVersion`（从 1 开始的用户级单调整数）、通用字段。

`authorizationVersion` 是业务会话唯一使用的授权版本。每次成功的角色授权/撤销，以及会影响教师数据范围的 `teacher_class_grants` 授予/撤销，都必须在同一事务内对目标用户文档执行 CAS 并递增一次。会话 bootstrap、角色选择和 actor 解析不得再从单条授权记录的 `version` 推导或取最大值；会话中的旧版本一律立即拒绝。

不得保存明文密码或可登录手机号。账号密码与手机号由 CloudBase Authentication v2 托管；业务库只可在 OQ-10 批准后保存页面确需的 `mobileMasked?`，且不能用于认证或查询完整号码。虚构种子不提供该字段。

索引：`organizationId + status + deletedAt`。

### 3.4 `auth_identities`

隔离外部身份与业务用户，避免把 `_openid` 当业务用户 ID。

最小字段：`_id`、`userId`、`organizationId`、`provider: cloudbase_uid`、`providerSubjectDigest`、`status: active|revoked`、`verifiedAt`、`lastUsedAt`、通用字段。不得保存密码明文、手机号、微信会话密钥或 AppSecret。M1 不创建 openid provider 映射。

索引：

- `provider + providerSubjectDigest`（唯一，UID 先规范化再做带服务端 pepper 的摘要）
- `organizationId + userId + status`

CloudBase UID 是 M1 唯一平台认证 subject；微信 provider 绑定推迟到需要订阅消息的后续里程碑。

### 3.5 `role_assignments`

最小字段：`_id`、`organizationId`、`userId`、`role: student|parent|teacher|admin`、`status: active|revoked`、`permissions: string[]`、`scopeType: self|classes|organization`、`scopeIds: string[]`、`grantedBy`、`grantedAt`、`revokedAt?`、通用字段。

索引：

- `organizationId + userId + status`
- `organizationId + role + status`
- `organizationId + scopeType + scopeIds + status`（实际组合索引需以 CloudBase 控制台能力验证）

后台管理员 role 可存在业务模型中，但绝不返回给小程序 P-02。

### 3.6 `class_memberships`

最小字段：`_id`、`organizationId`、`classId`、`studentId`、`status: active|transferred|inactive`、`joinedAt`、`leftAt?`、通用字段。

索引：

- `organizationId + classId + status + studentId`
- `organizationId + studentId + status`

同一有效学生/班级关系使用确定性 ID 或唯一索引防重复。转班保留历史，不改已发布任务 assignment 的 `classId` 快照。

### 3.7 `teacher_class_grants`

最小字段：`_id`、`organizationId`、`teacherId`、`classId`、`permissions`（如 `task.read/task.publish/submission.review/student.manage`）、`status: active|revoked`、`grantedBy`、`grantedAt`、`revokedAt?`、通用字段。

索引：

- `organizationId + teacherId + status + classId`
- `organizationId + classId + status`

CloudBase 当前控制台会把字段集合相同且方向相同、仅交换 `teacherId/classId` 顺序的两个四字段索引判定为等价并拒绝重复创建。因此教师方向保留四字段索引，班级方向使用三字段前缀索引；按班级查询时若还带 `teacherId`，先由三字段索引收敛范围，再过滤教师标识。该行为已于 2026-09-13 在 M1 开发环境空集合中验证。

教师每次查询/写入均校验当前授权；撤销授权不会改变历史任务对象或提交，但教师立即失去后续访问，管理员按范围接管审计。

### 3.8 `parent_student_links`

最小字段：`_id`、`organizationId`、`parentId`、`studentId`、`status: active|revoked`、`confirmedBy`、`confirmedAt`、`revokedAt?`、`revokedBy?`、通用字段。

索引：

- `organizationId + parentId + status + studentId`
- `organizationId + studentId + status`

与教师—班级授权相同，反向查询使用三字段前缀索引，避免 CloudBase 将仅交换双方标识顺序的四字段索引判定为等价。

服务端在事务中强制“家长最多 5 个孩子、学生最多 3 个家长”。解绑只撤销关系，孩子学习数据不删除；所有家长查询每次重新校验 active link。

### 3.9 `binding_codes`

最小字段：`_id`、`organizationId`、`studentId`、`codeDigest`、`status: active|used|expired|revoked|locked`、`attemptCount`、`expiresAt`、`usedAt?`、`usedByParentId?`、`createdBy`、通用字段。

只保存带服务端 pepper 的摘要，不保存 6 位明文。有效期 24 小时、单次使用、连续错误 5 次作废；使用、关系创建和审计必须在同一事务中。索引 `status + expiresAt` 用于按状态收敛后扫描过期记录，清理策略待 OQ-10。

### 3.10 `learning_resources`

M1 只包含基础阅读和单词的虚构/已授权占位内容。

最小字段：`_id`、`organizationId`、`type: reading|vocabulary|exercise`、`title`、`contentVersion`、`status: draft|published|offline`、`visibilityScope`、`payload`（按类型判别的结构化对象）、`copyrightStatus: demo|verified`、通用字段。M1 学习进度服务使用同一资源文档的服务端访问投影：`allowedStudentIds`、阅读型 `pages[{id, chapterId, pageNumber}]`、单词型 `wordIds`；投影只能由内容/授权服务维护，客户端不得传入或改写。

阅读资源的 `payload` 在 M1 至少包含章节与页面顺序、每页缩略图/高清页图的稳定资产键或文件 ID、图片尺寸及版本。OCR/结构化文本可作为搜索、无障碍和后续点读映射数据保留，但不得作为 S-04 的独立可见正文；M3 再在页面记录上补充归一化点读热区、音频片段和跟读文本关联。

索引：`organizationId + type + status + updatedAt`。M1 种子只允许 `copyrightStatus: demo`，不得导入 asset/output 中的真实或待确认教材。

### 3.10a `reading_progress`

记录学生自主阅读的续读位置和收藏状态。最小字段：`_id`、`organizationId`、`studentId`、`resourceId`、`chapterId`、`pageId`、`pageNumber`、`favorite`、`updatedAt`、`version`、软删除字段。

`_id` 由 `organizationId + studentId + resourceId` 确定性生成；服务端同时按这三个字段校验唯一归属。索引：`organizationId + studentId + resourceId`（唯一）。查询和写入必须使用可信会话中的学生身份；资源下架或学生不在资源授权投影中时不返回进度正文，也不允许更新。

### 3.10b `vocabulary_progress`

记录学生按词包累计的练习结果。最小字段：`_id`、`organizationId`、`studentId`、`packId`、`completedCount`、`correctCount`、`correctRate`、`wrongWordIds`、`updatedAt`、`version`、软删除字段。

`_id` 由 `organizationId + studentId + packId` 确定性生成；服务端同时按这三个字段校验唯一归属。索引：`organizationId + studentId + packId`（唯一）。错词 ID 必须属于当前词包；正确数不得大于完成数。首次创建要求 `expectedVersion=0`，后续更新使用文档 `version` 做 CAS。

两类进度写入均在同一原生事务中完成：资源授权复核、进度 CAS、`idempotency_records` 和 `operation_logs` 原子提交。相同 `operationId` 和相同请求返回第一次结果；相同键不同请求返回 `CONFLICT`。事务提交失败时不得留下部分进度或成功幂等记录。

### 3.11 `tasks`

最小字段：

- `_id`、`organizationId`、`creatorTeacherId`、`title`、`deliveryType: classroom`。
- `status: draft|scheduled|active|expired|withdrawn|closed|completed`。
- `targetType: classes|students`、`targetClassIds`、`targetStudentIds`。
- `startsAt`、`dueAt`、`latePolicy`、`description?`、`teacherNote?`。
- `items[]`：`id/type/resourceId/resourceVersion/resourceSnapshot/completionRule/scoringRule/order`。
- `publishedAt?`、`version`、软删除字段；已发布删除另记 `visibility: visible|recycled` 与 `recoverableUntil?`。

索引：

- `organizationId + creatorTeacherId + status + dueAt`
- `organizationId + targetClassIds + status + dueAt`
- `organizationId + visibility + updatedAt`

发布时一次性冻结内容和目标学生名单；目标名单实体化为 `task_assignments`。已发布任务不得物理删除。

### 3.12 `task_assignments`

最小字段：`_id`、`organizationId`、`taskId`、`studentId`、`classId`（发布时快照）、`status`、`progressPercent`、`latestSubmissionId?`、`latestSubmissionVersion`、`redoCount`、`redoDueAt?`、`isLate`、`submittedAt?`、`reviewedAt?`、通用字段。

状态：`not_started|in_progress|awaiting_review|completed|redo_required|overdue`。

索引：

- `organizationId + taskId + studentId`（唯一）
- `organizationId + studentId + status + updatedAt`
- `organizationId + taskId + status + submittedAt`
- `organizationId + classId + taskId + status`

可采用由 taskId/studentId 推导的确定性 `_id`，同时在事务中检查冲突。

### 3.13 `submissions`

最小字段：`_id`、`organizationId`、`taskId`、`assignmentId`、`studentId`、`version`、`status: draft|submitted|reviewed|returned|superseded`、`answers[]`、`isLate`、`submittedAt?`、`supersedesSubmissionId?`、通用字段。

索引：

- `organizationId + assignmentId + version`（唯一）
- `organizationId + studentId + status + updatedAt`
- `organizationId + taskId + status + submittedAt`

草稿可在同一版本内更新并递增文档 `version` 乐观锁；正式提交后答案不可修改。重做创建新的提交版本，旧版本标记 `returned/superseded` 但不删除。

### 3.14 `review_feedback`

最小字段：`_id`、`organizationId`、`taskId`、`assignmentId`、`submissionId`、`submissionVersion`、`teacherId`、`decision: approved|returned`、`score?`、`textComment?`、`returnReason?`、`publishedAt`、`source: manual`、通用字段。

索引：

- `organizationId + submissionId`（M1 每版本最多一个正式反馈，唯一）
- `organizationId + taskId + publishedAt`
- `organizationId + teacherId + publishedAt`

正式反馈只追加；未来修订需新版本模型，不直接覆盖。M1 不创建 AI 建议或语音点评字段。

### 3.15 `idempotency_records`

最小字段：`_id`、`organizationId`、`actorUserId`、`functionName`、`action`、`operationId`、`requestHash`、`status: processing|succeeded|failed`、`resultRef?`、`safeResult?`、`errorCode?`、`expiresAt`、`createdAt`、`updatedAt`。

`_id` 由组织、用户、函数、动作和 operationId 的摘要确定。相同键且请求摘要不同返回 `CONFLICT`；相同请求返回第一次的稳定结果。保留期由 OQ-10 决定。

### 3.16 `operation_logs`

只追加字段：`_id`、`organizationId`、`requestId`、`actorUserId`、`actorRole`、`action`、`targetType`、`targetId`、`result: succeeded|denied|failed`、`errorCode?`、`metadata`（白名单小字段）、`occurredAt`。

严禁记录密码、手机号、绑定码、题干/答案正文、录音、点评正文、token、openid 原文或堆栈。索引：`organizationId + occurredAt`、`organizationId + actorUserId + occurredAt`、`requestId`（唯一）。保留期和导出权限由 OQ-10 决定。

### 3.17 `migration_runs`

仅开发/测试环境使用。字段：`_id`、`organizationId`、`schemaVersion`、`seedVersion`、`source: m0-fixture`、`status`、`startedAt/finishedAt`、`counts`、`contentHash`、`createdDocumentIds?`、`executedBy`。分批种子另记录 `requestId`、`batchSize`、`totalBatches`、`nextBatchIndex`、`verifiedBatchCount`、`rollbackCursor`、`failureCode?` 和 `failedFromStatus?`。状态固定为 `planned|applying|verifying|succeeded|failed|rolling_back|rolled_back`；只有全量文档与 run 归属 verify 完成后才可进入 `succeeded`。不存账号凭据。

## 4. 关系与写入聚合

```text
organizations 1 ── * classes
users 1 ── * auth_identities / role_assignments
classes 1 ── * class_memberships / teacher_class_grants
parent users 1 ── * parent_student_links * ── 1 student users
tasks 1 ── * task_assignments 1 ── * submissions 1 ── 0..1 review_feedback
learning_resources 1 ── * tasks.items.resourceSnapshot（复制，不引用可变正文）
users(student) 1 ── * reading_progress / vocabulary_progress
```

事务边界：

1. 发布任务：任务版本校验、幂等记录、任务快照、全部 assignment、审计日志。
2. 正式提交：assignment 版本校验、新提交版本、assignment 当前指针/状态、幂等记录、审计日志。
3. 发布点评：提交版本/教师授权校验、反馈、submission/assignment 状态、重做次数与期限、幂等记录、审计日志。
4. 使用绑定码：码状态/次数、双方绑定上限、关系创建、码消费和审计日志。
5. 保存学习进度：资源授权、进度唯一键/CAS、幂等记录和审计日志。

CloudBase 当前服务端事务有操作数与仅按文档访问等限制。目标学生必须在事务前按授权查询解析，事务内再按确定性文档 ID 复核。单次发布规模超过已批准事务预算时禁止静默分批；需先关闭 OQ-09 并评审可恢复的批次方案。

按班级解析目标学生时还必须把 `classes.version` 带入事务作为 membership 集合 guard；事务内 guard 校验、membership 复核、任务/assignment/幂等/审计写入属于同一原子事务。按学员布置不依赖班级集合扫描，仍逐个按 membership 确定性 ID 复核。

## 5. M0 → M1 映射

| M0 来源 | M1 目标 | 兼容说明 |
| --- | --- | --- |
| `AppState.users` | `users` + `role_assignments` + `class_memberships` | 当前单 role 拆为授权记录；页面仍接收 `UserAccount` 视图 |
| `UserAccount.classId` | `class_memberships.classId` | Cloud adapter 聚合回当前视图，不要求页面改字段 |
| M0 隐含教师班级 | `teacher_class_grants` | M1 每次服务端校验 |
| M0 隐含家长关系 | `parent_student_links` | M1 不再通过“第一个学生”推断孩子 |
| `AppState.tasks` | `tasks` | 补齐组织、快照、target、latePolicy、审计和软删除字段 |
| `Task.items` | `tasks.items[]` | 保持嵌入，增加来源版本与完整快照 |
| `AppState.assignments` | `task_assignments` | 保持状态独立和 task+student 唯一 |
| `AppState.submissions` | `submissions` | 保持 assignment 内版本递增；正式版本不可变 |
| `AppState.feedback` | `review_feedback` | 精确绑定 submission/version，只追加 |
| M0 内存操作结果 | `idempotency_records` | 支持网络重试返回同一 receipt |
| M0 无审计集合 | `operation_logs` | 仅白名单元数据 |
| M0 页面本地阅读/单词记录 | `reading_progress` + `vocabulary_progress` | 以组织+学生+资源/词包唯一，支持跨函数实例续读和复习 |

当前 `domain/types.ts` 和 `app-service.ts` 是可运行 M0 的轻量实现，不要求现在改动。M1 接入阶段在 repository/cloudbase 与 service 映射层把上述集合聚合成当前页面需要的 `HomeView`、`TaskDetailView` 等；新增 M1 字段先作为服务端/adapter 内部类型。

## 6. 删除与保留

| 对象 | 默认动作 | 物理清理 |
| --- | --- | --- |
| 草稿任务/草稿提交 | 可按权限软删除；未发布且无引用时可进入清理队列 | 保留期确认后 |
| 已发布任务 | `visibility=recycled`，未完成入口隐藏，7 天内可恢复 | 历史记录不随回收物理删除 |
| 用户/班级/授权 | 停用或撤销，保留历史引用 | 合规批准后 |
| submissions/feedback/logs | 不允许业务端硬删除 | OQ-10 决定 |
| 虚构开发种子 | 按 `seedRunId/migrationRunId` 精确清理 | 允许在开发环境回滚，不使用全库删除 |

## 7. 明确不在 M1 本次设计落地

- 长期任务、排行榜、模板、全七类任务内容和通知（M2）。
- 音视频上传/转码、播放心跳、防快进、AI、题目音频对位（M3）。
- 生产数据、真实内容、真实账号迁移、发布与试点合规（M4）。

这些对象未来通过新集合或版本化字段扩展，不得提前改变当前 M0 页面调用。
