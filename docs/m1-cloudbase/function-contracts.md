# M1 CloudBase 云函数合约

> 目标：在现有应用 service/repository 边界后增加 CloudBase 实现。页面继续调用 service，不直接调用集合，也不因 M1 被迫改写。

## 1. 统一线协议

```ts
type ApiVersion = 'm1.v1'

interface FunctionRequest<TAction extends string, TPayload> {
  apiVersion: ApiVersion
  action: TAction
  payload: TPayload
  operationId?: string
  expectedVersion?: number
}

interface ResponseMeta {
  requestId: string
  serverTime: string
  apiVersion: ApiVersion
}

type FunctionResult<T> =
  | { ok: true; data: T; meta: ResponseMeta }
  | { ok: false; error: ServiceError; meta: ResponseMeta }
```

`TPayload` 必须是已知字段的严格 schema；未知字段拒绝或忽略的策略按 action 固定，不使用 `any`。身份字段不属于 payload。所有时间输入在边界验证为带时区 ISO 8601，服务端存储后再映射为 ISO 字符串。

小程序侧 `repositories/cloudbase` 只负责：

1. 把当前 service command 转为上面的请求。
2. 调用 `wx.cloud.callFunction`。
3. 把平台异常映射为 `NETWORK_ERROR/SERVICE_UNAVAILABLE/INTERNAL_ERROR`。
4. 把成功数据映射回当前页面 view model，并保留 `requestId`。

当前 `app-service.ts` 的页面调用可保留。M1 接入时以依赖注入/工厂选择 memory 或 cloudbase repository；禁止页面直接新增 `wx.cloud.callFunction`。

## 2. 错误码

线协议采用 `docs/service-contracts.md` 已定义口径：

```ts
type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RESOURCE_OFFLINE'
  | 'TASK_NOT_SUBMITTABLE'
  | 'REDO_LIMIT_REACHED'
  | 'DUPLICATE_OPERATION'
  | 'NETWORK_ERROR'
  | 'SERVICE_UNAVAILABLE'
  | 'INTERNAL_ERROR'
```

当前 `domain/types.ts` 只含其中六项，这是 M0 轻量实现的现状。本准备任务不修改它；M1 接入时可先扩展共享 union 和 adapter 映射，不需要改页面调用或业务流程。

规则：

- `message` 只包含可展示安全文案；不返回堆栈、集合名、手机号、openid 或对象存在性细节。
- `fieldErrors` 仅用稳定字段路径，如 `title`、`dueAt`、`items[0]`。
- `CONFLICT` 由客户端刷新最新实体后决定是否重试。
- 相同幂等请求已完成时优先返回第一次成功 receipt；只有调用方需要辨识重复时才返回 `DUPLICATE_OPERATION`，不得再次写入。
- 平台异常在云函数边界捕获并记录 requestId；客户端不接收裸异常。

## 3. 云函数清单

### 3.1 `auth-session`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `bootstrap` | 空对象；平台请求已带 CloudBase UID | `sessionId, userId, roles[]` | `AuthService.login` 的第二阶段 |
| `selectRole` | `role` | `ActiveSession` | `AuthService.selectRole` / 当前 `listRoles` 后的会话选择 |
| `getCurrentSession` | 空对象 | `ActiveSession` | `AuthService.getCurrentSession` |
| `logout` | 空对象；需 operationId | `void` | `AuthService.logout` |

`AuthService.login` 在 cloudbase repository 中是一个组合动作：先调用 CloudBase Authentication v2 的 `Auth.signIn({ username: mobile, password })`，再调用 `auth-session.bootstrap`。手机号和密码只进入官方 Auth SDK，不传入雅睿英语云函数、不写业务数据库或日志。`bootstrap` 从平台认证上下文取得 UID，查询 active `auth_identities/users/role_assignments` 后签发短期业务 session。

约束：后台管理员角色不返回给小程序；客户端传 userId/role/org 不可信；没有业务映射的 CloudBase UID 一律 `FORBIDDEN`。平台 Auth 错误在 repository 适配器中映射为现有 `ServiceResult`，页面仍调用当前 `login(mobile, password)`。

### 3.2 `task-query`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `getTeacherWorkbench` | `classId?, date` | `TeacherWorkbenchView` | `TeacherTaskService.getWorkbench` |
| `listTeacherTasks` | `filters, page` | `PageResult<TeacherTaskListItem>` | `TeacherTaskService.listTasks` / 当前 `getTeacherTasks` |
| `getDraftOptions` | 空对象 | `TaskDraftOptions` | `TeacherTaskService.getDraftOptions` |
| `previewTask` | 草稿字段或 `taskId, expectedVersion` | `StudentTaskPreview` | `TeacherTaskService.previewTask` |
| `getCompletion` | `taskId, filter, page` | `TaskCompletionView` | `ReviewService.getCompletion` / 当前 `getCompletion` |

教师查询由当前 class grants 收敛；不接受客户端扩大班级范围。统计从 assignments/submissions/feedback 聚合，不维护页面独立计数副本。

### 3.3 `task-command`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `saveDraft` | `taskId?, title, itemRefs[], target, startsAt, dueAt, latePolicy, description?, teacherNote?` | `TaskDetailView` | `TeacherTaskService.saveDraft` |
| `publishTask` | `taskId, expectedVersion`；operationId 必填 | `PublishedTaskSummary` | `TeacherTaskService.publishTask` / 当前 `publishClassroomTask` |
| `updatePublishedTask` | 允许字段、`expectedVersion`；operationId 必填 | `TaskDetailView` | 后续保持同一 service 边界 |
| `withdrawTask` | `taskId, expectedVersion, reason`；operationId 必填 | receipt | 任务生命周期 command |
| `recycleTask` | `taskId, expectedVersion, reason`；operationId 必填 | receipt | T-07 删除语义 |

`saveDraft` 可引用资源 ID，但发布必须在服务端重新读取资源状态、复制内容/规则快照、解析目标名单，并在同一事务生成 task + assignments + 幂等结果 + 审计。发布规模受 OQ-09 决策门约束。

### 3.4 `student-task-query`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `getHome` | `localDate` | `StudentHomeView` | `StudentTaskService.getHome` / 当前 `getHome` |
| `listMyTasks` | `filters, page` | `PageResult<StudentTaskListItem>` | `StudentTaskService.listMyTasks` / 当前 `listStudentTasks` |
| `getMyTask` | `taskId` | `StudentTaskDetailView` | `StudentTaskService.getMyTask` / 当前 `getTaskDetail` |

studentId 只取可信上下文。`localDate` 只是用户视图请求，服务端用 organization.timeZone 校验日期边界和排序。

### 3.5 `submission-command`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `saveDraft` | `taskId, answers[], draftVersion?`；operationId 建议必填 | `SubmissionView` | `StudentTaskService.saveDraft` / 当前 `saveDraft` |
| `submit` | `taskId, answers[], draftSubmissionId?, draftVersion?`；operationId 必填 | `SubmissionReceipt` | `StudentTaskService.submit` / 当前 `submitTask` |

正式提交事务：

1. 从 actor 得到 studentId 并读取 assignment/task。
2. 校验任务快照要求、提交窗口、redo 状态与 expected/current 版本。
3. 为 assignment 原子分配下一个 submission version。
4. 新增不可变 submitted 文档，更新 assignment 指针/状态/进度。
5. 写幂等结果和审计。

重复 operationId 返回同一 `submissionId/version/submittedAt`，不得产生新版本。

### 3.6 `review-query`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `listReviewTasks` | `filters, page` | `PageResult<ReviewTaskListItem>` | `ReviewService.listReviewTasks` |
| `getSubmissionForReview` | `submissionId` | `ReviewSubmissionView` | `ReviewService.getSubmissionForReview` |
| `previewBatchComment` | `taskId, filter, selection, comment` | `BatchReviewPreview` | 批量点评预览 |

`BatchReviewPreview` 包含短时 `previewToken`、`previewVersion`、eligibleCount、excludedCount 和安全摘要，不回传无权限详情。

### 3.7 `review-command`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `publishReview` | `submissionId, decision, score?, textComment?, returnReason?, expectedSubmissionVersion`；operationId 必填 | `ReviewReceipt` | `ReviewService.publishReview` / 当前 `reviewSubmission` |
| `publishBatchComment` | `previewToken, previewVersion, textComment`；operationId 必填 | `BatchReviewReceipt` | `ReviewService.publishBatchComment` |

服务端必须再次校验教师 class grant、提交当前版本、已有反馈、点评动作和重做上限。一键点评逐条排除未完成、已点评、越权或版本变化项；不覆盖人工分数。批量事务无法容纳批准上限时采用明确的批次作业设计，不能在一个成功响应后留下未报告的部分成功。

### 3.8 `parent-query`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `getHome` | `childId` | `ParentHomeView` | `ParentReadService.getHome` / 当前 `getParentHome` |
| `listChildTasks` | `childId, filters, page` | `PageResult<ParentTaskListItem>` | `ParentReadService.listChildTasks` |
| `getChildTask` | `childId, taskId` | `ReadonlyTaskDetailView` | `ParentReadService.getChildTask` / 当前 `getParentTask` |
| `getFeedback` | `childId, feedbackId` | `FeedbackDetailView` | `ParentReadService.getFeedback` / 当前 `getParentFeedback` |

每个 action 都重新校验 active parent link。返回模型不含命令、teacherNote、手机号或其他学生信息。

### 3.9 `relationship-command`

| action | 输入 payload | 输出 |
| --- | --- | --- |
| `issueBindingCode` | `studentId`；教师/管理员 operationId 必填 | `code, expiresAt`（明文只在本次响应出现） |
| `bindChild` | `studentNumber, code`；家长 operationId 必填 | `ParentStudentLinkView` |
| `unbindChild` | `childId, expectedVersion, reason`；operationId 必填 | receipt |

绑定码服务端摘要存储，24 小时、单次使用、错误 5 次锁定；绑定事务强制 5/3 上限并留确认记录。学生编号的真实字段和账号策略待 OQ-04/OQ-10。

### 3.10 `content-query`

M1 只提供基础阅读/单词查询：`listReadingResources`、`getReadingResource`、`listVocabularyPacks`、`getVocabularyPack`。只返回已上架、组织/班级授权内容；任务历史内容从 task snapshot 读取。M2/M3 的媒体、题库、AI 不在此函数提前实现。

### 3.11 `organization-admin`

仅独立后台入口，动作最小为：`listClasses/createClass/updateClass/disableClass`、`listUsers/createUser/disableUser`、`assignRole/revokeRole`、`grantTeacherClass/revokeTeacherClass`。所有写操作要求管理员具体 permission、scope、expectedVersion、operationId 和审计原因。认证与入口在 OQ-06 关闭前不得开放。

## 4. 幂等策略

- operationId 由调用方为一次用户意图生成，重试复用；不同按钮操作不得复用。
- 服务端幂等键包含 organization、actor、function、action、operationId，保存规范化 requestHash。
- 第一次请求创建 `processing` 记录；同请求完成后保存稳定 receipt 或结果引用。
- 同键同摘要：处理中返回可重试冲突/查询状态；成功则返回原结果；确定性业务失败返回原错误。
- 同键不同摘要：`CONFLICT` 并审计，绝不执行。
- 不把整篇任务/点评正文复制进幂等记录，只保存安全 receipt/ref。

## 5. 事务与并发

| 用例 | 锁/版本 | 同一事务内写入 |
| --- | --- | --- |
| 发布任务 | task expectedVersion + deterministic assignment IDs | task、assignments、idempotency、audit |
| 保存提交草稿 | submission doc version | draft、assignment progress（如需要）、idempotency |
| 正式提交 | assignment version/latestSubmissionVersion | submission、assignment、idempotency、audit |
| 单条点评 | submission version + assignment version | feedback、submission/assignment、idempotency、audit |
| 绑定孩子 | binding code + 双方关系计数/guard | link、code、guard、idempotency、audit |

事务外不得调用第三方服务；事务冲突按平台能力有限次重试，仍冲突返回 `CONFLICT`。所有跨集合事务的文档 ID 必须预先解析且在事务内复核，避免基于旧查询结果授权。

## 6. 版本控制

- API `m1.v1` 在 M1 内向后兼容；破坏性变更使用新版本，不静默改变 action 语义。
- Task `version`：草稿或允许的已发布字段每次更新递增；发布要求 expectedVersion。
- Submission：`version` 表示业务提交序号；文档另有乐观锁版本时命名 `recordVersion`，避免混淆。
- Feedback：精确指向 `submissionId + submissionVersion`，新提交不覆盖旧反馈。
- Snapshot：记录 `resourceId + resourceVersion + snapshotSchemaVersion`；读取历史不回查可变正文。
- 分页游标包含 queryVersion；过滤或授权版本变化时返回 `CONFLICT`/新游标。

## 7. 兼容接入顺序

1. 为 memory repository 固化现有合约测试和 view model 快照。
2. 新增 cloudbase repository 实现与错误 mapper，不改页面。
3. 对同一测试用例分别运行 memory 与开发环境实现。
4. 通过配置工厂按构建环境选择实现；默认仍为 memory，直到 M0 退出与 M1 联调门通过。
5. 分能力切换 query，再切 command；任何阶段都可回退到 memory 演示，不迁移真实数据。

## 8. 非目标

本合约不包含真实 AI、音视频转码、防快进、题目音频片段、订阅消息或生产管理后台部署。未来供应商能力必须继续隐藏在服务端 adapter 后。
