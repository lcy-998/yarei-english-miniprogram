# M3 跟读试验评分接口契约（2026-10-02）

> 本契约供 S-05 学生端及 T-08 教师只读证据接线。**0.80.0 状态（2026-10-07）：**非生产云端已部署 command/query/worker，Python 推理函数超时设为 210 秒；结果仍为“试验性评分”，不计正式任务分或打卡 AI 分。真实学生端到端评分和 `TCB_QcsRole` 调用 Python 推理的权限尚未实测。业务函数沿用 `m1.v1` 封套、可信业务会话和统一错误码；客户端不能直调内部 Python 推理函数。2026-10-02 用户已放宽原 15 秒硬门槛，云端等待与质量仍以单独证据为准。

**0.79.0 延迟结果补充（2026-10-07）：**已确认异步作业可在学生正式提交后完成，但仅限录音文档冻结的组织/学员/任务/分配关系/任务项/句段/提交版本/源快照 tuple 与该提交一致，且该版本含同一阅读任务项的正式答案。迟到试验分仅附于原版本供学生回看，不改变正式成绩、任务关系、教师正式评分、家长正式报告或打卡。系统失败可用新 operationId 重试同一录音，不计有效尝试；提交后不接受新录音或新有效尝试。撤权、身份失效、源快照/哈希不符或版本不匹配时拒绝落结果。具体规则见 `m3-pronunciation-delayed-result-decision-2026-10-06.md`。

## 学生端

新增 `pronunciation-command`、`pronunciation-query`。客户端不得传学生 ID、组织 ID、参考文本、分数、文件哈希或模型版本；这些值均由服务端按当前会话和冻结内容取得。

1. `pronunciation-command.beginRecording`：`payload: { source: { kind: "task", taskId, itemId, segmentId } | { kind: "reading", resourceId, segmentId } }`，封套带稳定的 `operationId`。返回 `{ recordingId, stagingPath, expectedVersion: 1, source, referencePreview, durationLimits: { minMs: 1000, maxMs: 300000, maxBytes: 20971520 } }`。客户端将 MP3 上传到该私有暂存路径；`referencePreview` 仅供显示，评分文本以服务端快照为准。任务模式必须由已发布任务项及当前提交轮次解析句段；自主阅读必须由当前授权的已审核资源版本解析句段。缺少冻结跟读文本时拒绝开始。
2. `pronunciation-command.sealRecording`：`payload: { recordingId, stagingFileId }`，封套带新 `operationId` 和 `expectedVersion: 1`。服务端核对路径、学生归属、格式、大小、时长、SHA-256、任务/阅读授权和版本，封存为私有录音。返回 `{ recordingId, expectedVersion: 2, durationMs }`。上传或核验失败时本机录音保留。
3. `pronunciation-command.beginScore`：`payload: { recordingId }`，封套带本次操作 ID 和当前 `expectedVersion`。可信服务先持久写入 `processing`/待派发作业与幂等回执，再立即返回，不在学生请求内等待模型；S-05 可离页，S-09 整份提交可以并行发生。结果为 `scored | unreliable | failed`，只有 `scored` 含 `score: { total, pronunciation, fluency, completeness }`（0—100 整数）；`unreliable` 含 `qualityReason` 无分数。系统自动重试最多一次；最终 `failed` 可用新 operationId 和最新 expectedVersion 对同一 recordingId 手动重试，系统重试不计有效次数。0.79.0 允许正式任务提交后原作业完成/系统失败重试，结果仅附原版本，用户可从 S-09 进入 S-12 回看；禁止提交后换录音/产生新有效尝试，且试验结果不改正式成绩、任务状态或打卡。

   **平台调用限制**：CloudBase 官方 FAQ 说明函数间 SDK `callFunction` 默认约 15 秒、与被调函数配置取较短值。因此只增加上述环境变量或 Python 函数 `timeout` 不能保证长录音成功；完整业务接线须在云端验证可配置的 SDK 等待，或改为真正异步事件作业和持久化 `processing`。本轮仅内部基准用管理端 SCF `Invoke(Event)` 测模型，不把它冒称为已完成学生端异步评分。
4. `pronunciation-query.getScore`：`payload: { scoreId }`，无 `operationId` 和 `expectedVersion`。仅返回本人当前可访问或本人历史提交版本对应的安全投影，包括 `draft | sealed | processing | scored | unreliable | failed` 状态、必要的试验结果字段、提交版本和评分时间。S-05 可轮询；S-12 本人列表显示处理/失败/终态并携带安全的 `expectedVersion` 供同录音失败重试。`pronunciation-query.listAttempts` 按已授权阅读资源或任务项返回历史尝试，任务项记录带原 `submissionVersion`；跨版本只供本人历史查看，不可回写当前轮次。

所有返回均为 `{ ok, data?, error?, meta }`。`MEDIA_INVALID` 表示格式或 1 秒至 5 分钟/20 MB 录音不合格；`TASK_NOT_SUBMITTABLE` 表示当前轮次不可评分；`CONFLICT` 表示操作 ID、录音或版本冲突；`FORBIDDEN`/`NOT_FOUND` 表示当前主体无权访问；`SERVICE_UNAVAILABLE` 表示推理不可用或两次超时。低置信度属于成功处理的 `unreliable` 状态，界面显示“暂无法可靠评分”，不得转成零分。

## 教师只读

`pronunciation-query.getTeacherEvidence`：`payload: { taskId, assignmentId, submissionVersion, itemId, segmentId }`。服务端按当前教师与班级授权、正式提交版本、同一任务项的阅读答案和录音来源 tuple/发布快照核对；返回 `{ scoreId, recordingId, durationMs, status, experimental: true, score?, qualityReason?, modelVersion, algorithmVersion, sourceVersion, submissionVersion, scoredAt, playback? }`。`playback` 仅在录音未满 180 天且媒体仍可用时给短期试听地址，读取和试听均留审计。未提交的试验结果不得作为教师正式成绩；家长端不展示试验分。教师只读页不得调用学生评分写入口，也不得因试听写入学生进度。

## 版本与处理约束

- 评分记录绑定 `organizationId`、`studentId`、`source`、录音 SHA-256、跟读文本快照哈希、资源/任务快照版本、提交轮次、模型与算法版本、操作 ID。除仅供本人历史读取外，任一变化均须拒绝旧结果用于当前任务。
- 阅读资源的服务端版本和已发布任务项的 `resourceSnapshot.payload` 必须含审核过的 `pronunciation: { reviewStatus: "approved", sourceVersion, approvedAt, approvedBy, segments: [{ id, text, pageNumber?, demonstrationAudioAssetKey }] }`。阅读版权状态须为 `verified`，`sourceVersion` 须等于内容版本；任务发布时冻结该结构。缺失或句段 ID 不匹配即拒绝跟读评分，绝不回退使用客户端显示文本或 OCR 原文推断。
- 自主阅读的 `submissionVersion` 为 `null`；任务模式开始时绑定 `latestSubmissionVersion + 1`。任务正式提交后，录音记录若匹配已提交版本的任务/分配/任务项/句段/源快照，且该版对应任务项含正式阅读答案，允许该录音现有异步作业完成及系统失败重试；重试不增加有效尝试数，不允许替换录音或发起新的有效尝试。结果只附于原提交版本，不能跨退回重做轮次或覆盖答案。
- 试验分不写入 `SubmissionRecord` 的自动成绩、活动条件或家长正式报告。教师人工覆盖正式评分仍走现有 `review-command`，需原因并保留原始试验记录。
- 文本片段结构、云端函数名与响应字段在学生/教师接线前按本文件冻结；如确需更改，先更新本文并通知两个任务。
