# M1 CloudBase 云函数合约

> 目标：在现有应用 service/repository 边界后增加 CloudBase 实现。页面继续调用 service，不直接调用集合，也不因 M1 被迫改写。

## 1. 统一线协议

```ts
type ApiVersion = 'm1.v1'

interface FunctionRequest<TAction extends string, TPayload> {
  apiVersion: ApiVersion
  action: TAction
  payload: TPayload
  businessSessionToken?: string
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

`TPayload` 必须是已知字段的严格 schema；未知字段拒绝或忽略的策略按 action 固定，不使用 `any`。身份字段不属于 payload。`businessSessionToken` 是 `auth-session.bootstrap` 返回的短期、不透明 bearer 值，客户端只负责原样携带，不能从中声明用户、角色、组织或权限。云函数通过 `@cloudbase/js-sdk` Node 运行时的当前请求 Auth 上下文独立取得 UID，再由部署侧 `TrustedBusinessSessionSource` 将 token 解析为内部 session，并校验两者绑定、有效期、撤销态和当前授权版本。缺 UID、缺 token/source、伪造 token、跨平台主体重放或已撤销 token 均返回 `UNAUTHENTICATED`。所有时间输入在边界验证为带时区 ISO 8601，服务端存储后再映射为 ISO 字符串。

小程序侧 `repositories/cloudbase` 只负责：

1. 把当前 service command 转为上面的请求；除 `bootstrap` 外，从本机会话取 `sessionId` 作为不透明 `businessSessionToken` 放入请求顶层。
2. 云模式由同一个 `@cloudbase/js-sdk` v3 app 先执行 Auth v2 `signInWithPassword({ phone, password })`，再调用结构化 `app.callFunction({ parse: true })`；SDK 登录态随函数请求传播，密码不进入业务函数 envelope。
3. 把平台异常映射为 `NETWORK_ERROR/SERVICE_UNAVAILABLE/INTERNAL_ERROR`。
4. 把成功数据映射回当前页面 view model，并保留 `requestId`。

当前 `app-service.ts` 的页面调用可保留。M1 接入时以依赖注入/工厂选择 memory 或 cloudbase repository；禁止页面直接调用 SDK、原生 `wx.cloud.callFunction` 或数据库。提交版本继续默认 memory，缺少显式环境标识、JS SDK client port 或会话上下文时云模式失败关闭。

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

`AuthService.login` 在 cloudbase repository 中是一个组合动作：先调用 CloudBase Authentication v2 的 `signInWithPassword({ phone: mobile, password })`，再由同一 JS SDK app 调用 `auth-session.bootstrap`。手机号和密码只进入官方 Auth SDK，不传入雅睿英语云函数、不写业务数据库或日志。`bootstrap` 从平台认证上下文取得 UID，查询 active `auth_identities/users/role_assignments` 后签发短期业务 session；当前 `sessionId` 即客户端视角的不透明 token。身份选择、当前会话和退出请求通过顶层 `businessSessionToken` 传输，退出成功后客户端清除本地 token，服务端 session 已撤销，重放继续失败。

约束：后台管理员角色不返回给小程序；客户端传 userId/role/org 不可信；没有业务映射的 CloudBase UID 一律 `FORBIDDEN`。平台 Auth 错误在 repository 适配器中映射为现有 `ServiceResult`，页面仍调用当前 `login(mobile, password)`。

### 3.1a `admin-session`

| action | 输入 payload | 输出 | 说明 |
| --- | --- | --- | --- |
| `bootstrap` | 空对象；平台请求已带可信 CloudBase UID | `audience, token, expiresAt` | 独立后台登录的第二阶段 |
| `refresh` | 空对象；顶层携带后台 token | `audience, token, expiresAt` | 重新复核后延长短时会话 |
| `getCurrentSession` | 空对象；顶层携带后台 token | `audience, token, expiresAt` | 复核当前后台会话 |
| `logout` | 空对象；需 operationId | `void` | 撤销后台业务会话 |

`admin-session` 复用与小程序相同的可信 UID、identity repository、持久化 business session 和六项部署密钥，不新增密钥；但使用独立 `admin-console` audience、token 前缀/加密用途和 session slot。后台 token 不可调用小程序业务入口，小程序 token 也不可调用 `organization-admin`。每次调用重新校验 active identity、用户、组织、唯一 active admin 角色和用户级 `authorizationVersion`；停用、撤权、版本变化、过期或退出后均返回 `UNAUTHENTICATED`。管理员仍不得出现在小程序 `selectRole`。

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

M1 只提供基础阅读/单词查询：`listReadingResources`、`getReadingResource`、`listVocabularyPacks`、`getVocabularyPack`。`getReadingResource` 返回章节、页码、页序、缩略图/高清页图资产描述、图片尺寸、版本和进度所需标识，不返回供 S-04 另行排版展示的正文块；OCR/结构化文本仅作为服务端搜索、无障碍和后续点读映射数据。只返回已上架、组织/班级授权内容；任务历史内容从 task snapshot 读取。M2/M3 的媒体、题库、AI 不在此函数提前实现。

### 3.11 `organization-admin`

仅独立后台入口，动作最小为：`getDashboardOverview`、`listClasses/createClass/updateClass/disableClass`、`listUsers/createUser/updateUser/disableUser`、`listRoleAssignments/assignRole/revokeRole`、`grantTeacherClass/revokeTeacherClass`、`listAuditLogs`。所有 action 只接受 `admin-console` audience，并从可信 actor 取得管理员角色、`organizationId`、permissions 和 scope；客户端不得提交这些字段。所有写操作要求管理员具体 permission、scope、expectedVersion、operationId 和审计原因。`updateUser` 仅允许更新展示姓名，并推进用户 `authorizationVersion` 使旧授权会话失效；手机号、密码和角色分别由 Auth/角色 action 管理。

`getDashboardOverview` 要求 `organization.read`，默认聚合最近 7 天，显式 `from/to` 必须同时为带时区 ISO 8601 且跨度不超过 31 天；班级、用户、任务、完成和异常统计均先按可信 scope 收敛。缺少任务查询 repository 时安全返回 `SERVICE_UNAVAILABLE`。`listRoleAssignments` 要求 `authorization.manage`，`listAuditLogs` 要求 `audit.read`；两者 payload 固定为精确的 `filter` 与 `page:{limit,offset}` 对象，`limit` 为 1—50、`offset` 为 0—1000。服务端总结果窗口最多 1000 条，超限安全关闭；响应 total 是窗口内未截断的精确总数。

审计列表只返回固定字段及 metadata 白名单投影（班级、角色、scope 类型、有限计数/版本和是否提供原因），不返回自由文本原因、手机号、token、堆栈或其他任意 metadata。class scope 管理员只能看到可明确归属其班级的角色和日志；无法证明 scope 归属的记录一律不返回。

### 3.12 `teacher-student-query`

| action | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- |
| `listStudents` | `filters, page` | `TeacherStudentPage` | `TeacherStudentQueryService.listStudents` |
| `getStudent` | `studentId` | `TeacherStudentDetail` | `TeacherStudentQueryService.getStudent` |

查询范围由可信教师 actor、当前 `teacher_class_grant` 和 `student.read` 权限共同收敛；客户端班级筛选只能缩小范围。查询 action 禁止携带 `operationId` 或 `expectedVersion`。

### 3.13 `teacher-student-command`

| action | 顶层字段 | 输入 payload | 输出 | 对应 service |
| --- | --- | --- | --- | --- |
| `updateProfile` | `operationId, expectedVersion` | `studentId, classId, displayName, expectedMembershipVersion, reason` | `TeacherStudentMutationReceipt` | `TeacherStudentCommandService.updateProfile` |
| `setStatus` | `operationId, expectedVersion` | `studentId, classId, status, expectedMembershipVersion, expectedClassVersion, reason` | `TeacherStudentMutationReceipt` | `TeacherStudentCommandService.setStatus` |
| `transfer` | `operationId, expectedVersion` | `studentId, sourceClassId, targetClassId, expectedMembershipVersion, expectedTargetMembershipVersion, expectedSourceClassVersion, expectedTargetClassVersion, reason` | `TeacherStudentTransferReceipt` | `TeacherStudentCommandService.transfer` |

顶层 `expectedVersion` 固定表示学生用户记录版本，`operationId` 固定表示本次用户意图；二者不得放入 payload。payload 使用精确 schema，不接受 actor、角色、组织、权限、scope 或会话声明。服务端只使用可信 actor，并在事务内复核 `student.manage`、源/目标班实时授权、学生/成员/班级版本，原子提交业务写入、幂等结果与脱敏审计。

TCH-001 批量导入/导出暂不增加云函数 action。M1 当前只提供严格 UTF-8 CSV 的本地模板解析、行错误结果、命令计划和筛选导出；账号创建与实际批量写入必须经过后续独立服务端流程，详见 `teacher-student-bulk-csv.md`。

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
