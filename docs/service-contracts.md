# M0 Service 与 Repository 合约

## 1. 约定

页面只依赖应用 service，不直接访问模拟数据或 repository 实现。所有调用返回 `Promise<ServiceResult<T>>`，无论 M0 是同步内存操作还是 M1 云函数调用，避免替换数据源时改写页面流程。

```ts
type ServiceResult<T> =
  | { ok: true; data: T; meta?: { requestId: string } }
  | { ok: false; error: ServiceError; meta?: { requestId: string } }

interface ServiceError {
  code: ErrorCode
  message: string
  retryable: boolean
  fieldErrors?: Record<string, string>
}

interface RequestContext {
  sessionId: string
  actorUserId: string
  actorRole: 'student' | 'parent' | 'teacher'
  organizationId: string
}
```

`message` 是可展示的安全文案，不包含内部堆栈或敏感数据；详细诊断只记录匿名 requestId 和错误码。时间统一为带时区 ISO 8601 字符串。

## 2. 错误码

| 错误码 | 含义 | 可重试 |
| --- | --- | --- |
| `VALIDATION_ERROR` | 字段或业务输入无效 | 否，需修正输入 |
| `UNAUTHENTICATED` | 会话不存在或失效 | 否，回登录 |
| `FORBIDDEN` | 角色或数据关系无权访问 | 否 |
| `NOT_FOUND` | 对象不存在或对当前用户不可见 | 否 |
| `CONFLICT` | 状态/版本已变化，防止覆盖 | 查询最新后重试 |
| `RESOURCE_OFFLINE` | 资源不可新引用 | 否 |
| `TASK_NOT_SUBMITTABLE` | 未开始、撤回、关闭或超过补交/重做期限 | 否 |
| `REDO_LIMIT_REACHED` | 已达退回次数上限 | 否 |
| `DUPLICATE_OPERATION` | 幂等键已处理 | 按既有结果返回 |
| `NETWORK_ERROR` | 模拟或真实网络异常 | 是 |
| `SERVICE_UNAVAILABLE` | 服务暂不可用 | 是 |
| `INTERNAL_ERROR` | 未分类服务错误 | 通常是 |

页面按 `code` 映射行为，不解析 message 判断逻辑。模拟错误必须使用相同结构。

## 3. 应用 Service

以下为契约级伪代码，后续实现可拆文件，但不能改变权限和数据语义。

### AuthService

```ts
login(input: { mobile: string; password: string }): Promise<ServiceResult<{
  sessionId: string
  userId: string
  roles: RoleSummary[]
}>>

selectRole(ctx: RequestContext, input: {
  role: 'student' | 'parent' | 'teacher'
}): Promise<ServiceResult<ActiveSession>>

getCurrentSession(sessionId: string): Promise<ServiceResult<ActiveSession>>
logout(sessionId: string): Promise<ServiceResult<void>>
```

M0 只接受演示凭据并返回虚构账号。密码不写日志、不进入持久化缓存。单身份可由页面直接选择后跳转；后台管理员角色永不返回给小程序。

### TeacherTaskService

```ts
getWorkbench(ctx: RequestContext, input: { classId?: string; date: string }): Promise<ServiceResult<TeacherWorkbenchView>>
listTasks(ctx: RequestContext, query: TeacherTaskQuery): Promise<ServiceResult<PageResult<TeacherTaskListItem>>>
getDraftOptions(ctx: RequestContext): Promise<ServiceResult<TaskDraftOptions>>
saveDraft(ctx: RequestContext, input: SaveTaskDraftCommand): Promise<ServiceResult<TaskDetailView>>
previewTask(ctx: RequestContext, input: PreviewTaskCommand): Promise<ServiceResult<StudentTaskPreview>>
publishTask(ctx: RequestContext, input: PublishTaskCommand): Promise<ServiceResult<PublishedTaskSummary>>
```

`PublishTaskCommand` 包含 `operationId`、期望任务版本、阅读/单词/习题内容标识、目标班级或学生、时间、描述和教师备注。service 校验教师授权、资源状态、时间、对象和版本，在单一 repository 事务中创建任务快照与 assignments。

### StudentTaskService

```ts
getHome(ctx: RequestContext, input: { localDate: string }): Promise<ServiceResult<StudentHomeView>>
listMyTasks(ctx: RequestContext, query: StudentTaskQuery): Promise<ServiceResult<PageResult<StudentTaskListItem>>>
getMyTask(ctx: RequestContext, taskId: string): Promise<ServiceResult<StudentTaskDetailView>>
saveDraft(ctx: RequestContext, input: SaveSubmissionDraftCommand): Promise<ServiceResult<SubmissionView>>
submit(ctx: RequestContext, input: SubmitTaskCommand): Promise<ServiceResult<SubmissionReceipt>>
```

service 从 ctx 确定 studentId，忽略客户端伪造的他人学生标识。正式提交校验任务快照要求和可提交窗口；提交成功后 assignment 进入 `awaiting_review`。相同 `operationId` 重试返回同一 receipt。

### ReviewService

```ts
listReviewTasks(ctx: RequestContext, query: ReviewTaskQuery): Promise<ServiceResult<PageResult<ReviewTaskListItem>>>
getCompletion(ctx: RequestContext, input: { taskId: string; filter: AssignmentFilter }): Promise<ServiceResult<TaskCompletionView>>
getSubmissionForReview(ctx: RequestContext, submissionId: string): Promise<ServiceResult<ReviewSubmissionView>>
publishReview(ctx: RequestContext, input: PublishReviewCommand): Promise<ServiceResult<ReviewReceipt>>
publishBatchComment(ctx: RequestContext, input: BatchReviewCommand): Promise<ServiceResult<BatchReviewReceipt>>
```

M0 仅人工检查、评分、文字点评和退回。批量点评必须先由查询返回预览对象，command 带预览版本和 operationId；repository 再次排除未完成、已点评、越权或版本变化的提交，不能依赖页面勾选保证安全。

### ParentReadService

```ts
getHome(ctx: RequestContext, childId: string): Promise<ServiceResult<ParentHomeView>>
listChildTasks(ctx: RequestContext, query: ParentTaskQuery): Promise<ServiceResult<PageResult<ParentTaskListItem>>>
getChildTask(ctx: RequestContext, input: { childId: string; taskId: string }): Promise<ServiceResult<ReadonlyTaskDetailView>>
getFeedback(ctx: RequestContext, input: { childId: string; feedbackId: string }): Promise<ServiceResult<FeedbackDetailView>>
```

每次调用都校验有效 `ParentStudentLink`，不能因为页面曾选中过孩子而跳过授权。返回模型不包含任何 command 或可编辑字段。

### MockScenarioService

```ts
listScenarios(): Promise<ServiceResult<MockScenarioSummary[]>>
activateScenario(scenarioId: string): Promise<ServiceResult<{ schemaVersion: number }>>
resetActiveScenario(): Promise<ServiceResult<void>>
failNext(input: { method: string; code: ErrorCode }): Promise<ServiceResult<void>>
```

此服务只在开发/评审构建可用，不进入正式产品入口。生产构建工厂不得注册它。

## 4. Repository 接口

Repository 以聚合和用例为边界，不向页面暴露集合式 CRUD：

```ts
interface TaskRepository {
  findTaskForActor(ctx: RequestContext, taskId: string): Promise<Task | null>
  listTeacherTasks(ctx: RequestContext, query: TeacherTaskQuery): Promise<PageResult<Task>>
  saveDraft(ctx: RequestContext, task: Task, expectedVersion?: number): Promise<Task>
  publishWithAssignments(input: PublishAggregateInput): Promise<PublishedTaskAggregate>
}

interface SubmissionRepository {
  findAssignment(ctx: RequestContext, taskId: string): Promise<TaskAssignment | null>
  saveDraft(input: SaveSubmissionAggregateInput): Promise<Submission>
  submit(input: SubmitAggregateInput): Promise<SubmissionReceipt>
  listForReview(ctx: RequestContext, query: ReviewQuery): Promise<PageResult<SubmissionAggregate>>
}

interface ReviewRepository {
  publish(input: PublishReviewAggregateInput): Promise<ReviewReceipt>
  publishBatch(input: BatchReviewAggregateInput): Promise<BatchReviewReceipt>
  findFeedbackForParent(input: AuthorizedParentFeedbackQuery): Promise<ReviewFeedback | null>
}
```

内存实现要求：

- 初始化后持有单一状态树，写操作完成前不暴露中间状态。
- 输入和输出均复制；测试可使用冻结对象侦测意外修改。
- 用 `expectedVersion` 检测并发覆盖，用 `operationId` 缓存写入结果。
- 查询排序、分页、筛选和统计与未来云实现使用同一合约测试。
- 通过注入的 clock 和 id generator 保证测试可重复，不在领域规则中直接调用 `Date.now()` 或随机数。

## 5. 页面调用约定

1. 页面进入时先设置加载状态，再调用 query；已有数据时刷新失败保留旧数据和更新时间。
2. command 提交前进行友好字段预校验，但 service 必须重复执行完整校验。
3. 同一按钮在请求中禁用；失败保留表单、筛选、作答或点评输入。
4. 页面卸载后忽略迟到响应，避免对销毁页面调用 `setData`。
5. 只有 `ok: true` 才更新成功状态；异常必须在 service 边界转为 `ServiceError`，页面不接收裸异常。
6. 导航参数只传对象标识和来源，不传完整实体或权限结论。

## 6. M1 云函数替换边界

M1 的 CloudBase 适配器把同一 service command 转成云函数请求，把云函数响应映射回相同 `ServiceResult<T>`。服务端必须：

- 从可信会话解析用户、角色和组织，不信任客户端 ctx 中的授权字段。
- 校验输入 schema、权限、实体版本和业务状态。
- 对任务发布、提交版本、点评发布使用事务或原子操作。
- 使用 operationId 保证写操作幂等。
- 只返回页面所需字段，敏感字段在服务端脱敏或省略。
- 记录匿名操作日志和 requestId，不记录密码、真实手机号、题目正文、录音或点评正文。

CloudBase 之外的 AI、媒体和通知供应商由服务端 adapter 包装，后续接入时不得把供应商密钥或响应原文直接暴露给小程序。
