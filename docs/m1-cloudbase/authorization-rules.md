# M1 服务端授权与 CloudBase 规则

> 核心原则：客户端界面是否显示按钮不构成授权。数据库、存储和业务授权分别在 CloudBase 资源层与云函数内部强制执行。

## 1. 三层防线

1. **资源门禁**：数据库和云存储对客户端默认 `read=false/write=false`；客户端不能绕过 service 直接 CRUD。
2. **函数调用门禁**：云函数安全规则默认仅允许非匿名、已认证的平台身份调用；未列入客户端入口的管理/内部函数设为不可调用。
3. **业务授权**：每次调用由云函数从可信平台身份解析业务 session、用户、当前角色、组织和授权关系，并对目标对象再次校验。

CloudBase 官方函数安全规则不能表达本项目的学生/家长/教师/管理员细粒度角色，因此它只能做第一层门禁，不能替代函数内校验。

## 2. 可信请求上下文

云函数内部构造，不接受客户端覆盖：

```ts
interface TrustedActorContext {
  requestId: string
  sessionId: string
  actorUserId: string
  actorRole: 'student' | 'parent' | 'teacher' | 'admin'
  organizationId: string
  platformSubjectDigest: string
  permissions: readonly string[]
  scopeIds: readonly string[]
}
```

客户端仍可按 M0 合约传 `RequestContext` 作为适配期字段，但服务端必须忽略其中的 `actorUserId`、`actorRole`、`organizationId` 权限结论。服务端流程固定为：

```text
平台身份 → 业务 session → active user → active role assignment
→ organization 状态 → 当前关系/授权 → 目标实体归属/状态 → 业务规则
```

任一步失败即终止，不把数据库对象内容放进错误消息。

## 3. 角色规则

### 学生

- 只能读取自己的用户安全视图、active class membership、本人 task assignment、任务快照、本人 submission 和指向本人版本的反馈。
- `studentId` 永远从可信上下文得出；请求体中的同名字段不得用于授权。
- 只能保存/提交本人 assignment，且必须满足任务状态、开始/截止/补交/重做窗口和内容完整性。
- 不能改任务、assignment 归属、自动分、反馈、角色、班级或关系。

### 家长

- 每次读取孩子首页、任务、提交或反馈时，都验证同组织且 active 的 `parent_student_link`。
- 解绑后下一次请求立即失去全部历史数据访问权；缓存不得继续展示敏感详情。
- 只读，不能代学生保存草稿、提交、重做、改分或改点评。
- 只能看到页面所需的孩子数据，不返回同班其他学生、教师私密备注或账号字段。

### 教师

- 必须具备目标班级的 active `teacher_class_grant` 和对应 permission。
- 发布任务只能选择授权班级/学员和可引用资源；按班级发布时服务端解析并冻结目标学生名单。
- 检查/点评同时校验任务组织、当前班级授权、目标 assignment、submission 当前版本和点评状态。
- 不能修改学生原始提交；退回必须有原因且不超过 2 次；批量点评要逐条重新授权并排除不合格项。
- 教师授权撤销后立即失去访问，即使其为历史任务创建者；历史对象继续保留并由有范围的管理员审计。

### 管理员

- 管理员只通过独立后台身份进入，不出现在小程序 P-02。
- 每项操作校验具体 permission 和组织/班级 scope；`admin` 名称不代表无边界全权。
- 可在授权范围维护学校、班级、账号、角色和关系，且所有变更写审计日志。
- 高风险操作（停用、角色变更、重置、批量导入）使用二次确认、乐观锁和幂等键。
- 不提供“以学生/教师身份静默浏览全部内容”的默认能力；若未来需要代操作，必须有独立权限、原因和审计。

## 4. 操作矩阵

| 资源/操作 | 学生 | 家长 | 教师 | 管理员 |
| --- | --- | --- | --- | --- |
| 登录/当前会话 | 本人 | 本人 | 本人 | 独立后台方案待定 |
| 角色选择 | 本人 active 小程序角色 | 同左 | 同左 | 小程序禁止 |
| 班级/用户安全视图 | 本人 | 已绑定孩子 | 授权班级学员 | scope 内 |
| 任务查询 | 本人 assignment | 已绑定孩子 assignment | 授权班级 | scope 内 |
| 保存/提交作业 | 本人且窗口有效 | 禁止 | 代处理 M1 是否开放需产品确认；默认禁止 | 默认禁止，只审计 |
| 创建/发布任务 | 禁止 | 禁止 | `task.publish` + 目标授权 | scope + permission |
| 检查/人工点评 | 禁止 | 禁止 | `submission.review` + 目标授权 | scope + permission |
| 查看点评 | 本人版本 | 已绑定孩子版本 | 授权提交 | scope 内 |
| 绑定码生成 | 禁止 | 禁止 | `student.bind-code.issue` + 班级授权 | scope 内 |
| 使用绑定码 | 禁止 | 本人；校验上限与码 | 禁止 | 不代替家长消费 |
| 用户/权限管理 | 禁止 | 禁止 | 禁止 | 具体 permission + scope |
| 审计日志 | 禁止 | 禁止 | 仅本人必要操作摘要（若开放） | `audit.read` + scope |

“教师可代处理任务”来自总体产品权限矩阵，但 M1 具体交互/原因字段尚未在当前 service 代码中落地，因此默认关闭，不在本次前置设计中自行开放。

## 5. 对象级判定顺序

### 查询单对象

1. 验证 session、用户、角色和组织状态。
2. 按 `_id + organizationId + deletedAt` 查询最小元数据。
3. 根据角色校验本人、active link、class grant 或 admin scope。
4. 再查询/聚合可返回字段并执行服务端脱敏。

为降低枚举风险，跨组织或无可见关系的只读详情通常返回 `NOT_FOUND`；明确写操作的越权返回 `FORBIDDEN` 并记审计日志。对外 message 不透露对象是否存在。

### 列表查询

- 服务端先从授权关系得到允许的 classIds/studentIds，再把范围合入数据库查询。
- 客户端筛选只能缩小范围，不能扩大服务端范围。
- 分页游标绑定查询条件、actor 和过期时间；禁止复用他人的游标。
- 返回字段使用 allowlist，手机号、身份 subject、教师备注等默认不返回。

### 写操作

- 在事务外解析 session 和候选授权；事务内按确定性 ID 重新读取目标及版本。
- 校验 `operationId` 与请求摘要；同键不同请求返回 `CONFLICT`。
- 校验 `expectedVersion`、状态和业务窗口后写入聚合与审计。
- 事务失败不留下部分任务、部分 assignment 或孤立反馈。

## 6. CloudBase 规则草案

### 数据库/存储

本项目选择“业务数据不由客户端 SDK 直连”。每个业务集合应用：

```json
{
  "read": false,
  "write": false
}
```

云存储在 M1 如无必要不开启客户端上传。若基础资源确需文件，客户端先调用云函数取得受限、短时、指定路径的上传/下载能力；对象键按组织和业务对象生成，不能使用手机号/姓名。具体存储规则在首次使用前单独评审。

### 云函数

客户端业务函数建议默认：

```json
{
  "*": {
    "invoke": "auth.loginType != 'ANONYMOUS' && auth != null"
  }
}
```

内部管理/迁移/种子函数不得作为客户端可调用函数；如存在同环境函数名，显式设 `invoke: false`。`auth-session` 的平台调用门禁是否满足手机号+密码方案取决于 OQ-04/OQ-06，未确认前不发布规则。

## 7. 必测越权案例

| 编号 | 攻击/误用 | 预期 |
| --- | --- | --- |
| AUTHZ-01 | 学生把请求中的 studentId 改为同班或他班学生 | 拒绝；无数据泄露；审计 |
| AUTHZ-02 | 学生直接调用数据库 SDK 读取 assignments | 资源规则拒绝 |
| AUTHZ-03 | 家长使用已解绑 childId 查历史反馈 | `NOT_FOUND/FORBIDDEN`；缓存失效 |
| AUTHZ-04 | 家长调用 submit/saveDraft | `FORBIDDEN` |
| AUTHZ-05 | 教师给未授权班级发布任务 | `FORBIDDEN`；不生成 task/assignment |
| AUTHZ-06 | 教师点评另一教师且无当前班级授权的提交 | `FORBIDDEN` |
| AUTHZ-07 | 教师撤权后复用旧 session/分页游标 | 立即拒绝 |
| AUTHZ-08 | 客户端伪造 organizationId | 服务端忽略并按可信组织处理；跨组织拒绝 |
| AUTHZ-09 | 普通管理员扩大自身 scope 或权限 | `FORBIDDEN`；审计 |
| AUTHZ-10 | 把 admin 角色塞进小程序 selectRole | `FORBIDDEN`，小程序角色列表不返回 admin |
| AUTHZ-11 | 重放已消费/错误 5 次/过期绑定码 | 拒绝，不创建关系 |
| AUTHZ-12 | 用同 operationId 提交不同请求体 | `CONFLICT`，不执行第二次写入 |
| AUTHZ-13 | 查询软删除任务并继续提交 | 只按历史权限只读；新提交拒绝 |
| AUTHZ-14 | 批量点评夹带无权限或已有点评 submission | 逐条重检；不覆盖；返回安全结果摘要 |

## 8. 授权变更与缓存

- session 中的 role/scope 只作性能提示；每个高风险写入都读取最新授权版本。
- 角色、class grant、parent link 或账号停用后更新 `authzVersion`；缓存键包含该版本并短期失效。
- 权限降级优先于可用性：撤权后旧 token 即使未到期也不能继续访问业务数据。
- 任何授权缓存不得包含完整学生档案、手机号或点评正文。

## 9. 审计最小集

必须审计：登录成功/失败摘要、角色选择、越权拒绝、任务发布/撤回/回收、提交、退回、点评、绑定/解绑、账号/班级/权限变更、种子导入/回滚。日志只保留匿名业务 ID、动作、结果、错误码、版本和 requestId。
