# M1 CloudBase 控制台逐步操作手册

> 版本：2026-09-12。按钮名称按当前腾讯云/CloudBase 官方文档编写；控制台改版时选择语义相同入口。  
> 当前允许：创建一个免费、非生产、仅虚构数据的开发环境并做安全配置。  
> 当前禁止：支付、开启超限按量、部署业务函数、导入真实数据、上传体验版或提交审核。

## 一、最终选型速查

| 项目 | 固定选择 |
| --- | --- |
| 腾讯云账号 | 雅睿英语运营主体实名认证主账号 |
| 地域 | 上海 `ap-shanghai` |
| 数据库 | 文档型数据库/云数据库，不选 PostgreSQL/MySQL |
| 开发环境 | `yarei-m1-dev`，免费体验版，超限按量关闭 |
| 测试环境 | `yarei-m1-test`，M0 退出后购买个人版，购买前另行确认 |
| 非生产预算 | 50 元/月；50%/80%/100% 告警 |
| 登录 | CloudBase Authentication v2，手机号+密码，管理员预创建；密码不经过业务云函数 |
| 业务数据库权限 | 客户端全部拒绝，只有云函数服务端访问 |
| 云函数 | Node.js 20.19 事件函数；无公网 HTTP 入口 |
| M1 发布上限 | 单次最多 50 名学生 |

选择上海是硬约束：当前官方能力表中，上海支持文档型数据库；新加坡只支持 PostgreSQL，手机号登录/验证码也只支持上海。

## 二、执行前准备

准备以下信息，但不要把值写进仓库或聊天：

- 雅睿英语运营主体的腾讯云主账号登录方式。
- 腾讯云主账号 UIN、AppId（只用于本地配置 CAM 策略）。
- 小程序 AppID，以及拥有该小程序管理员权限的微信。
- 一名云资源管理员、一名日常开发者、一名只读审计/查看人员；人数不足时管理员与审计不可共用长期密钥。
- 接收费用和安全告警的邮箱/手机号；不得使用学生或家长联系方式。

先检查小程序归属：

1. 登录腾讯云控制台。
2. 右上角账号菜单进入 **账号中心**。
3. 找到 **登录方式** → **微信公众平台**。
4. 确认显示的正是雅睿英语将使用的小程序。
5. 若已绑定其他小程序或绑定在个人账号下，立即停止。CloudBase 环境不能跨账号原地迁移，先由小程序管理员完成账号归属处理。

## 三、保护主账号

1. 用主账号进入 **访问管理 CAM**。
2. 打开 **安全设置**，给主账号开启 MFA（优先虚拟 MFA/TOTP），并保存恢复方式。
3. 检查访问密钥列表：没有明确用途的长期 SecretId/SecretKey 不新建；已有密钥由负责人盘点和轮换，本步骤不删除未知密钥。
4. 在 **消息中心/消息订阅** 中确认安全通知和费用通知都有非学生的负责人接收。
5. 主账号完成环境开通后退出日常使用；后续 CLI 和控制台操作使用 CAM 子用户。

## 四、创建 `yarei-m1-dev` 免费环境

1. 打开 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev)。
2. 首次使用时勾选服务条款，允许系统创建 CloudBase 服务角色。此授权只做一次。
3. 如果系统自动发放免费体验环境：进入该环境，把环境别名改为 `yarei-m1-dev`。
4. 如果没有自动环境：点击 **新建环境**。
5. 在创建页逐项选择：
   - 环境别名：`yarei-m1-dev`
   - 地域：**上海 `ap-shanghai`**
   - 数据库类型：**云数据库/文档型数据库**
   - 套餐：**免费体验版，0 元/月**
   - 所需资源：文档型数据库、云函数；云存储可随环境存在但 M1 暂不上传文件
   - 超限按量/超限不停服：**关闭**
   - 自动续费：**关闭**（免费环境按官方规则在到期前人工检查）
6. 在最终确认页再次检查订单金额必须为 **0 元**。只要金额不是 0，停止，不点击购买/支付。
7. 点击创建/确认，等待环境状态变为 **正常/NORMAL**。初始化通常需要几分钟。
8. 进入环境概览，记录环境 ID；只填入本机 `.env.local`，不要写入源码或文档。
9. 给环境添加标签（若控制台支持）：`project=yarei-english`、`stage=dev`、`data=synthetic-only`、`owner=<负责人角色>`。

完成标准：控制台只有一个本项目开发环境，地域上海，0 元，超限关闭，状态正常。

## 五、设置费用与额度告警

### 5.1 CloudBase 环境额度

1. 在 CloudBase 平台选择 `yarei-m1-dev`。
2. 打开 **套餐用量/额度监控**。
3. 再次确认 **超限按量** 为关闭。
4. 开启或确认日限额告警：80%、90%、100%。
5. 告警接收人选择云管理员和费用负责人，不选学生/家长测试账号。

### 5.2 腾讯云月度预算

1. 进入腾讯云 **费用中心**。
2. 左侧选择 **成本管理** → **预算管理**。
3. 点击 **新建预算** → **自定义预算**。
4. 填写：
   - 预算名称：`Yarei-M1-NonProd-Monthly`
   - 周期：月度
   - 编制方式：固定预算
   - 金额：50 元
   - 费用范围：能按产品筛选时只选 CloudBase；不能筛选时选全部费用并在说明中标注本项目
5. 点击下一步，添加三条“实际费用”阈值：50%、80%、100%。
6. 通知频率选每次触发，通知时段选 24 小时；渠道至少选站内信和邮件。
7. 保存后进入 **消息订阅** → **费用中心** → **预算管理通知**，核对接收人。
8. 可选：在费用中心主页设置余额预警 20 元，但它不能代替预算告警。

## 六、创建最小权限 CAM 子用户

不让日常开发者使用主账号，也暂不创建 API 密钥。

### 6.1 创建用户

1. 主账号进入 **访问管理 CAM** → **用户** → **用户列表**。
2. 点击 **新建用户** → **自定义创建**。
3. 分别创建：
   - `yarei-m1-dev-admin`：环境配置与部署负责人。
   - `yarei-m1-dev-auditor`：只读查看日志、监控和配置。
4. 选择控制台访问；首次登录必须重置密码；为两者开启 MFA。
5. 不勾选 AdministratorAccess，不创建 SecretId/SecretKey。

### 6.2 建立按环境隔离的策略

1. 在 `yarei-m1-dev` 环境概览中，本地记录：UIN、AppId、region、envId、函数 namespace、日志 topicId、存储 bucket。
2. 打开腾讯云官方[CloudBase 按环境自定义策略](https://cloud.tencent.com/document/product/876/47057)。
3. 在 CAM 左侧选择 **策略** → **新建自定义策略** → **按策略语法创建** → **空白模板**。
4. 复制官方页面的完整“按环境隔离”策略，不从博客或聊天复制删减版本。
5. 仅在本地把 `${uin}`、`${appId}`、`${region}`、`${envId}`、`${namespace}`、`${topicId}`、`${bucket}` 换为开发环境真实值。
6. 保存为 `YareiM1DevEnvironmentAccess`，关联给 `yarei-m1-dev-admin`。
7. 为 auditor 另建 `YareiM1DevReadOnly`：只保留 Describe/Get/List/日志读取类动作，不包含 Create/Update/Delete/Deploy/购买/密钥管理动作；先使用 CAM 策略检查器确认，再关联 auditor。
8. 用两个子用户分别登录验证：admin 能进入该开发环境但不能访问其他环境；auditor 只能查看，不能修改。

若无法确认某条 CAM action 是否为只读，不猜测：先不授权，遇到明确拒绝后再按最小缺口补充。

## 七、关联微信小程序与开发环境

1. 使用小程序管理员微信，在腾讯云 **账号中心** → **登录方式** → **微信公众平台** 绑定目标小程序。
2. 打开微信开发者工具，导入 `D:\app\workspace`。
3. 点击顶部 **云开发**。
4. 进入 **设置** → **环境设置** → 展开环境列表 → **管理我的环境**。
5. 选择 **使用已有腾讯云环境**，选择 `yarei-m1-dev`。
6. 只确认环境在 IDE 可见；当前不要改 M0 repository、不要上传体验版、不要部署函数。

若环境不可见，先核对“小程序绑定的腾讯云账号”是否正是环境所属账号，不要重复创建第二个环境。

## 八、配置 CloudBase Authentication v2

### 8.1 登录方式

1. 在 `yarei-m1-dev` 打开 **身份认证** → **登录方式**。
2. 开启 **用户名密码登录/账号密码登录**。
3. 关闭 **匿名登录**。
4. 关闭邮箱、微信开放平台、第三方和自定义登录；M1 不使用它们。
5. 手机号短信登录先保持关闭，直到 P-03 找回密码开始联调；开启后业务代码必须使用 `getVerification({ target: 'USER' })`，只给已存在用户发验证码。
6. 在密码策略中设置（控制台支持的字段全部开启）：
   - 12—32 位；
   - 小写、大写、数字、特殊字符至少三类；
   - 首次登录强制修改临时密码；
   - 管理员启用 MFA（套餐/控制台支持时）；
   - 不开启自动注册入口。

### 8.2 会话

1. 使用环境默认 Authentication client，不额外创建未知用途的 OAuth client。
2. Access Token 保持官方默认 7200 秒。
3. Refresh Token：开发环境可保持默认；业务云函数仍签发/校验自己的短期业务 session。
4. 业务 session 上限：学生/家长/教师 12 小时，管理员 4 小时；管理员空闲 30 分钟需重新认证。
5. 账号、角色、家长关系或教师授权停用后，业务 session 通过 `authzVersion` 立即失效，不等待平台 token 到期。

### 8.3 创建虚构测试用户

当前不录入真实手机号：

1. 打开 **身份认证** → **用户管理** → **添加用户**。
2. 学生、家长、教师选择“注册用户/external user”；后台测试管理员选择“组织成员/internal user”。
3. 用户名使用 `demo_student_01`、`demo_parent_01`、`demo_teacher_01`、`demo_admin_01` 等明显虚构值。
4. 临时密码由密码管理器生成，不写文档，不沿用 M0 的 `123456`。
5. 如果控制台强制要求可接收短信的真实手机号，停止手机号联调；改用虚构用户名验证 Auth 与业务角色链路，不提供真实号码。
6. 用户创建后，在业务库中建立对应 `users`、`auth_identities(provider=cloudbase_uid)` 和 `role_assignments`；没有这三层映射的 UID 一律 `FORBIDDEN`。

正式手机号导入必须等待 OQ-10 合规批准。

免费环境若不提供应用用户 MFA 控件，只允许使用虚构 `demo_admin_01` 做接口验证。任何真实后台管理员上线前，必须切换到控制台明确支持 MFA 的套餐并完成 MFA 验收；不能用“开发环境没有该按钮”作为跳过理由。

## 九、创建数据库集合与默认拒绝规则

此阶段可以创建空集合，但不要导入数据：

1. 打开 **数据库/文档型数据库**。
2. 依次创建：`organizations`、`classes`、`users`、`auth_identities`、`role_assignments`、`class_memberships`、`teacher_class_grants`、`parent_student_links`、`binding_codes`、`learning_resources`、`reading_progress`、`vocabulary_progress`、`tasks`、`task_assignments`、`submissions`、`review_feedback`、`idempotency_records`、`operation_logs`、`migration_runs`。
3. 每创建一个集合立即进入 **权限管理** → **安全规则/自定义规则**。
4. 填入并发布：

```json
{
  "read": false,
  "write": false
}
```

5. 退出控制台后用客户端 SDK 尝试读写任一空集合，预期均为权限拒绝。
6. 按 `database-schema.md` 进入每个集合的 **索引管理** → **新建索引**，只建已列出的索引；唯一关系优先建唯一索引。
7. 索引名使用 `idx_<字段缩写>` 或 `uniq_<字段缩写>`，方向与实际筛选/排序一致。
8. 创建索引失败时先检查已有重复/超长字段，不删除现有数据规避错误。

## 十、准备云函数（M0 退出前只建配置，不部署业务）

1. 打开 **云函数** → **新建云函数**。
2. 类型选普通 **事件函数**，不选 HTTP/Web 函数。
3. 运行时选 `Nodejs20.19`，入口 `index.main`，内存 256 MB。
4. 函数名和超时按 `templates/cloudbaserc.example.json`：
   - 10 秒：查询函数和 `auth-session`。
   - 15 秒：`submission-command`、`relationship-command`。
   - 20 秒：`task-command`、`review-command`、`organization-admin`。
5. 在 **云函数** → **权限控制/安全规则** 中应用 `templates/function-security-rules.example.json`，默认 `auth != null`。
6. 不创建公网 HTTP 路由，不勾选匿名访问，不写 SecretId/SecretKey 环境变量。
7. 业务角色、组织、班级、家长关系必须在函数内部再次检查，不能依赖函数门禁。

在 M0 未退出、M1 函数代码未完成评审前，可以停在“空目录/离线模板”阶段，不需要在云端创建上述函数。

## 十一、本地 CLI 准备（需用户同意登录后）

CLI 不是创建开发环境的必要条件。需要部署联调时再执行：

```powershell
npm install -g @cloudbase/cli
tcb -v
tcb login
```

`tcb login` 会打开授权页，使用 `yarei-m1-dev-admin` 子用户确认，不使用主账号，也不粘贴 SecretId/SecretKey。

然后：

1. 把 `templates/.env.example` 复制为独立 M1 后端目录中的 `.env.local`。
2. 只在 `.env.local` 填真实 `TCB_ENV_ID` 和默认 Authentication client ID；该文件必须被 Git 忽略。
3. 把 `templates/cloudbaserc.example.json` 复制为该后端目录的 `cloudbaserc.json`。
4. 执行只读核对：`tcb env list --region ap-shanghai`，确认目标别名与环境 ID。
5. 不设置全局默认环境，避免其他项目误部署；每次部署前同时核对别名、envId 和 Git 分支。
6. 只有 M0 退出、代码评审和用户批准后，才执行 `tcb fn deploy`、规则发布或种子导入。

## 十二、开发环境验收

逐项截图或记录（截图遮住 envId、账号和联系方式）：

- [ ] 主账号属于运营主体并开启 MFA。
- [ ] 小程序绑定到正确腾讯云账号。
- [ ] `yarei-m1-dev` 为上海、文档型数据库、0 元、超限关闭、状态正常。
- [ ] 50 元月预算与 CloudBase 80%/90%/100% 额度告警已生效。
- [ ] admin/auditor 使用 CAM 子用户且权限隔离正确，无长期 API 密钥。
- [ ] 匿名登录关闭；账号密码开启；测试用户均为虚构。
- [ ] 所有业务集合客户端读写均拒绝。
- [ ] 未创建公网函数入口，未写入任何云密钥。
- [ ] M0 memory repository 仍是默认实现，页面流程不受影响。

## 十三、M0 退出后创建测试环境

1. 先取得 M0 退出记录和“允许购买个人版测试环境”的明确确认。
2. 在购买页核对个人版当前价格；2026-09-12 官方展示为 19.9 元/月限时优惠，以购买页最终金额为准。
3. 创建 `yarei-m1-test`，地域和数据库与开发环境完全相同。
4. 购买一个月，关闭自动续费和超限按量；不得购买资源包。
5. 为 test 单独创建 CAM 环境策略、`.env.test.local`、集合、规则和告警；不要复制 dev 的真实 envId。
6. 按 `migration-and-seed.md` 只导入虚构种子，再执行 `m1-test-plan.md`。
7. 测试结束后先导出测试报告，再按 seedRunId 精确回滚；环境是否续费由用户决定，不自动销毁。

## 十四、遇到这些情况立即停止

- 创建页显示非零订单或要求开启超限按量。
- 环境地域不是上海，或数据库不是文档型数据库。
- 小程序绑定账号与环境所属账号不一致。
- 控制台要求输入/下载长期 SecretId/SecretKey 才能继续普通开发。
- 需要真实学生、家长、教师手机号或真实教材才能完成测试。
- 某集合无法设为客户端拒绝，或某函数只能匿名开放。
- 需要删除、迁移或覆盖现有环境/数据。

停止后保留页面和错误码，先评审，不尝试通过扩大权限、开启付费或使用真实数据绕过。

## 十五、官方参考

- [创建 CloudBase 环境](https://docs.cloudbase.net/quick-start/create-env)
- [地域与能力](https://cloud.tencent.com/document/product/876/51107)
- [当前定价](https://tcb.cloud.tencent.com/pricing)
- [CloudBase 环境与额度](https://cloud.tencent.com/document/product/876/46895)
- [CAM 按环境授权](https://cloud.tencent.com/document/product/876/47057)
- [腾讯云预算管理](https://cloud.tencent.com/document/product/555/65784)
- [账号密码登录](https://docs.cloudbase.net/authentication-v2/method/username-login)
- [CloudBase 用户类型](https://docs.cloudbase.net/en/authentication-v2/auth/manage-users)
- [密码重置 API](https://docs.cloudbase.net/en/api-reference/webv2/authentication_v2)
- [数据库安全规则](https://docs.cloudbase.net/database/security-rules)
- [云函数安全规则](https://docs.cloudbase.net/cloud-function/security-rules)
