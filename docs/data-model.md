# M0 数据模型

## 1. 建模原则

M0 只建模最小闭环所需对象，数据存在内存 repository 中，但字段设计能映射到 M1 云数据库。所有实体使用不可变字符串标识、ISO 8601 时间、`organizationId`、`createdAt`、`updatedAt` 和显式状态。历史记录不做硬删除。

演示标识采用 `usr_`、`cls_`、`tsk_`、`sub_` 等前缀；标识不包含姓名、手机号或学号。所有姓名和学校均为虚构数据。

## 2. 核心实体

### Organization

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `org_` 标识 |
| name | string | M0 固定为虚构学校“启航实验学校” |
| status | `active \| disabled` | 组织状态 |
| createdAt / updatedAt | ISO string | 审计时间 |

### ClassRoom

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `cls_` 标识 |
| organizationId | string | 所属组织 |
| name | string | 如“三年级 2 班” |
| grade | number | M0 用 3、4 |
| studentIds | string[] | 当前有效学生标识 |
| teacherIds | string[] | 有授权的教师标识 |
| status | `active \| archived` | 班级状态 |
| createdAt / updatedAt | ISO string | 审计时间 |

### UserAccount

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `usr_` 标识 |
| organizationId | string | 当前所属组织 |
| displayName | string | 虚构展示名 |
| avatarKey | string? | 本地演示资源键，不存远程真实头像 |
| status | `active \| disabled` | 账号状态 |
| roleAssignments | RoleAssignment[] | 小程序可用身份 |
| createdAt / updatedAt | ISO string | 审计时间 |

`RoleAssignment` 包含 `role: student \| parent \| teacher`、可选 `classIds` 和授权状态。后台管理员不属于 M0 小程序身份。

### ParentStudentLink

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `rel_` 标识 |
| organizationId | string | 所属组织 |
| parentId / studentId | string | 家长和学生 |
| status | `active \| revoked` | 当前授权关系 |
| createdAt / updatedAt | ISO string | 审计时间 |

M0 只读使用固定关系；M1 才实现绑定码流程。所有家长查询必须以有效关系为前提，撤销后立即拒绝历史数据访问。

### LearningResourceSummary

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `res_` 标识 |
| organizationId | string | 所属组织 |
| type | `reading \| vocabulary \| exercise` | M0 三类资源 |
| title | string | 虚构标题 |
| contentVersion | number | 内容版本 |
| status | `published \| offline` | 是否可新引用 |
| payload | typed object | 完成要求所需最小模拟内容 |
| createdAt / updatedAt | ISO string | 审计时间 |

任务发布时复制为 `TaskItem.resourceSnapshot`；资源下架不改变历史任务。

### Task

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `tsk_` 标识 |
| organizationId / creatorTeacherId | string | 数据归属与创建者 |
| title | string | 1—50 字 |
| deliveryType | `classroom` | M0 只发布课堂任务 |
| status | TaskStatus | 发布生命周期 |
| classIds / studentIds | string[] | 按班级或学员二选一 |
| startsAt / dueAt | ISO string | 开始和截止时间 |
| latePolicy | object | 是否可补交及期限快照 |
| description | string? | 学生可见，最多 300 字 |
| teacherNote | string? | 仅教师可见，最多 100 字 |
| items | TaskItem[] | 至少 1 个任务内容快照 |
| publishedAt | ISO string? | 发布时刻 |
| version | number | 任务可编辑版本 |
| createdAt / updatedAt | ISO string | 审计时间 |

`TaskStatus` 使用 `draft \| scheduled \| active \| expired \| withdrawn \| closed \| completed`。学生提交、待检查和退回重做绝不写入此字段。

### TaskItem

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `tki_` 标识，在任务内稳定 |
| type | `reading \| vocabulary \| exercise` | M0 内容类型 |
| resourceId / resourceVersion | string / number | 来源追溯 |
| resourceSnapshot | typed object | 发布时不可变内容快照 |
| completionRule | typed object | 完成条件快照 |
| scoringRule | typed object | 计分规则快照 |
| order | number | 展示顺序 |

### TaskAssignment

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `asn_` 标识，任务+学生唯一 |
| organizationId / taskId / studentId | string | 归属关系 |
| classId | string | 发布时班级快照 |
| status | AssignmentStatus | 学生与任务关系状态 |
| progressPercent | number | 0—100 的展示进度 |
| latestSubmissionId | string? | 当前提交版本 |
| redoCount | number | 已退回次数，最多 2 |
| redoDueAt | ISO string? | 重做截止 |
| submittedAt / reviewedAt | ISO string? | 最近关键时间 |
| createdAt / updatedAt | ISO string | 审计时间 |

`AssignmentStatus` 使用 `not_started \| in_progress \| awaiting_review \| completed \| redo_required \| overdue`。是否逾期提交可另用 `isLate` 标记，避免丢失真实流程状态。

### Submission

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `sub_` 标识 |
| organizationId / taskId / assignmentId / studentId | string | 归属与权限 |
| version | number | 同一 assignment 从 1 递增 |
| status | `draft \| submitted \| reviewed \| returned` | 当前版本状态 |
| answers | SubmissionAnswer[] | 按任务项记录模拟作答 |
| isLate | boolean | 是否补交 |
| submittedAt | ISO string? | 正式提交时间 |
| createdAt / updatedAt | ISO string | 审计时间 |

草稿可更新；一旦 `submitted`，作答内容不可覆盖。重做创建新版本，旧版本永久保留。

### ReviewFeedback

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | string | `fbk_` 标识 |
| organizationId / taskId / assignmentId | string | 数据归属 |
| submissionId / submissionVersion | string / number | 精确指向被点评版本 |
| teacherId | string | 发布教师 |
| decision | `approved \| returned` | 检查结论 |
| score | number? | 0—100，可选取决于任务规则 |
| textComment | string? | M0 人工文本点评 |
| returnReason | string? | 退回时必填 |
| publishedAt | ISO string | 正式可见时间 |
| createdAt / updatedAt | ISO string | 审计时间 |

M0 不生成 AI 建议或语音点评对象。至少有检查结论、评分或文字点评中的有效动作后才能发布；退回必须有原因。

## 3. 关系

```text
Organization 1 ── * ClassRoom
Organization 1 ── * UserAccount
ClassRoom * ── * UserAccount（通过角色授权）
Parent User 1 ── * ParentStudentLink * ── 1 Student User
Teacher User 1 ── * Task
Task 1 ── * TaskItem
Task 1 ── * TaskAssignment（每位目标学生一条）
TaskAssignment 1 ── * Submission（版本历史）
Submission 1 ── 0..1 ReviewFeedback（M0 每版本至多一个正式结果）
```

## 4. 一致性规则

- 发布任务时在同一写操作中固化任务项快照并为目标学生创建 assignment；部分成功必须回滚。
- `(taskId, studentId)` 唯一，`(assignmentId, version)` 唯一。
- 完成数来自 assignment 状态，不从页面缓存累加；待点评数为有效提交中尚无正式反馈的数量。
- 反馈必须指向明确提交版本；新版本不会覆盖旧反馈。
- 家长列表、学生详情和教师完成情况通过同一 assignment/submission/feedback 生成视图，不保存互相独立的统计副本。
- 资源下架只禁止新任务引用，历史 `resourceSnapshot` 仍可只读展示。

## 5. M1 CloudBase 映射

建议集合：`organizations`、`classes`、`users`、`role_assignments`、`parent_student_links`、`learning_resources`、`tasks`、`task_assignments`、`submissions`、`review_feedback`、`operation_logs`。

嵌入 `TaskItem` 到 `tasks` 可保持发布快照原子性；提交答案嵌入 `submissions`。授权和高频过滤字段建立组合索引。客户端不直接信任 `organizationId` 或角色，云函数从服务端会话解析并覆盖调用者输入。

删除使用状态或 `deletedAt` 软删除。提交、反馈和操作日志按合规期限保留；具体期限在 M4 隐私与未成年人数据评审后冻结。
