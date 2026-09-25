# M1 CloudBase 开发环境准备

> 状态：M0 已于 2026-09-15 验收，当前主线为 M1；本文件同时作为开发环境复核门禁。
> 适用范围：仅 M1 后端核心闭环的开发/测试环境；不包含生产、提审、体验版、付费资源开通或真实数据。  
> 基线：`DOCUMENTATION.md` / `product-requirements-core.md` 0.18.1、`docs/architecture.md`、`docs/service-contracts.md`。

## 1. 已确定的腾讯云方案

用户已授权由本方案确定腾讯云技术选型。2026-09-12 起执行以下结论：

- **账号主体**：环境必须归属于雅睿英语实际运营主体实名认证的腾讯云主账号，不使用开发者个人账号。主账号只做开通、计费和紧急管理；日常使用 CAM 子用户。
- **地域**：固定 `ap-shanghai`（上海）。当前 CloudBase 文档型数据库和手机号登录/验证码能力均明确支持上海；本项目不选新加坡 PostgreSQL，也不使用白名单地域。
- **数据库**：CloudBase 文档型数据库，延续现有 repository 与文档快照设计。
- **环境**：M1 先使用一个 `yarei-m1-dev` 免费体验环境；独立 `yarei-m1-test` 个人版环境仅在用户另行确认购买后创建。
- **计费**：开发环境选择免费体验版、关闭超限按量、不开资源包；腾讯云账号设置 50 元/月非生产预算，50%/80%/100% 告警。若账号不具备免费环境资格，停止在支付页，不自动购买。
- **身份**：使用 CloudBase Authentication v2 托管账号密码。学生/家长/教师是注册用户（external/registered user），由管理员预创建；登录名使用已绑定手机号，密码不进入业务数据库。
- **无自主注册**：客户端只调用 Auth v2 `signInWithPassword({ phone, password })`，不提供 `signUp`。手机号和密码只进入官方 SDK，不进入业务函数；任何没有业务 `users + role_assignments` 映射的 CloudBase UID 即使存在，也无法进入产品。
- **微信身份**：M1 以 CloudBase UID 作为唯一认证 subject，不把 openid 当业务主键，也不在 M1 自动合并账号。微信 provider 绑定留到订阅消息/生产联调前单独验证。
- **后台管理员**：使用同一 CloudBase 用户目录和默认 Auth client，但使用独立 Web 页面与业务 session audience；管理员不出现在小程序。管理员账号采用组织成员/internal user 和更短业务会话。任何真实管理员启用前必须使用支持 MFA 的套餐/配置；免费开发环境只放虚构管理员。
- **租户**：M1 一个环境只服务一个试点学校，但每条业务数据仍保留 `organizationId`，不删除未来多学校扩展边界。
- **发布上限**：2026-09-25 起单次任务最多包含 500 名学生。超过原有 50 人事务预算时，服务端按每批 20 条学生任务记录分批提交；任务保持草稿且对学生不可见，直到全部记录完成。中断可用同一发布意图继续，超过 500 人返回 `VALIDATION_ERROR`。现有云端 50 人通过记录不代表此扩容已在云端验证，部署与验证仍须单独授权。

详细控制台执行步骤见 `console-runbook.md`。2026-09-17 复核确认既有 17 个集合均为空；经用户单独授权后补建 `reading_progress`、`vocabulary_progress`，并将全部 19 个集合统一为 `ADMINONLY`。两个新增进度集合的三字段唯一索引已核验；`auth-session` 所需三类身份集合主查询索引也已复核。其他既有索引仍须按 `database-schema.md` 完成全量对账，不能沿用历史记录直接判定通过。真实个人信息与合规期限仍不是腾讯云技术可以代替决定的事项，继续列在 `open-questions.md`。

## 2. 环境拓扑

| 逻辑用途 | 建议显示名 | 环境 ID | 数据 | 是否允许部署 |
| --- | --- | --- | --- | --- |
| 本地/M0 | `yarei-local-m0` | 不适用 | 现有内存虚构数据 | 不使用 CloudBase |
| M1 开发 | `yarei-m1-dev` | 仅填入本机 `.env.local`，不得提交 | 仅虚构种子 | 已有环境待只读复核；部署须单独授权 |
| M1 测试 | `yarei-m1-test` | 用户确认购买后创建独立环境 | 仅虚构测试数据 | 个人版购买必须单独确认支付 |
| 预生产/生产 | 待命名 | 未创建 | 禁止在本任务使用 | 禁止 |

上述别名与地域已经确定；真实 `envId` 仍不写入仓库。即使环境 ID 本身不是密钥，也通过本地环境变量注入，避免误部署到错误环境。

## 3. 用户必须亲自完成的控制台步骤

用户或获授权的云账号管理员按 `console-runbook.md` 执行；付费、账号授权和真实数据动作仍需用户亲自确认：

1. 登录腾讯云/CloudBase 控制台，确认账号主体、实名认证、成员与最小权限分工。
2. 选择免费体验版、上海地域、文档型数据库，确认超限按量关闭后创建 M1 开发环境；若出现非零订单立即停止。
3. 创建 50 元/月预算和 50%/80%/100% 告警；CloudBase 日限额告警保留 80%/90%/100%。
4. 记录环境 ID 到开发者本机的 `.env.local`，不得粘贴到聊天、文档、源码或提交记录。
5. 在微信开发者工具中，由有权限人员把小程序项目关联到已确认的开发环境；不要上传体验版或提交审核。
6. 开启账号密码登录；关闭匿名、邮箱和第三方登录。短信验证码只在实现“已存在用户找回密码”时开启，并始终使用 `target=USER`，业务层不接受自注册 UID。
7. 建立数据库集合、索引和默认拒绝规则；规则清单见 `database-schema.md` 和 `authorization-rules.md`。
8. 创建云函数后，将函数调用权限设为 `auth != null`；更细角色权限必须由函数内部校验。
9. 开启函数日志、错误告警、数据库备份/恢复能力和预算告警，但日志不得记录密码、手机号、题目正文、录音或点评正文。
10. 为日常开发、运维和审计分配不同的最小权限账号；管理员权限只在必要时使用。

## 4. 本地准备（不登录、不部署）

本目录提供以下安全模板，当前 `workspace/m1-cloudbase/` 已作为隔离的本地实现目录：

- `templates/cloudbaserc.example.json`：仅声明计划函数与环境变量占位符。
- `templates/.env.example`：只包含非秘密变量名和空占位值。
- `templates/deny-all.database-rule.json`：应逐集合应用的客户端默认拒绝规则。
- `templates/function-security-rules.example.json`：云函数调用的第一层门禁草案。
- `templates/development-seed.example.json`：最小虚构闭环数据，不含账号凭据。

准备方式：需要联调时在 `workspace/m1-cloudbase/` 中创建被 Git 忽略的 `.env.local`，只由操作者在本机填写。M1 通过 repository adapter 接入，页面不得直接调用 CloudBase；未经授权不安装 CLI/SDK、不登录、不部署。

若后续决定使用 CloudBase CLI，先由用户确认安装与账号授权，再按官方流程安装 `@cloudbase/cli`。`tcb login` 会触发账号授权，本任务禁止执行；任何 `tcb fn deploy`、数据库导入或规则发布同样禁止执行。

## 5. 密钥和配置边界

| 项目 | 可否提交 | 存放位置 |
| --- | --- | --- |
| 示例环境名、函数名、schema 版本 | 可以 | 本目录模板 |
| 真实 CloudBase `envId` | 不提交 | 开发者本机 `.env.local` / CI 受保护变量 |
| 腾讯云 SecretId/SecretKey | 绝不提交 | 优先不使用；确需 CI 时放受保护密钥库并使用最小权限/临时凭据 |
| CloudBase 环境 API Key | 绝不提交 | 受保护密钥库；确认后按环境最小授权 |
| AppSecret、短信、AI、媒体供应商密钥 | 绝不提交 | 对应服务端密钥管理；M1 本任务不创建 |
| 手机号、密码、绑定码明文 | 绝不提交或写日志 | 真实系统仅保存必要的加密值/摘要；策略待确认 |

普通事件云函数应使用平台注入的当前环境能力，不在代码中硬编码云凭据。若未来选择 HTTP/Web 云函数，其鉴权和密钥要求需单独安全评审。

## 6. 环境验收清单

在允许 M1 接入主线之前逐项记录证据：

- [ ] 环境所有者、地域、计费、预算和环境用途已确认。
- [ ] 开发环境中只有虚构数据，且有明显的非生产标识。
- [ ] 数据库集合对客户端直接读写均为拒绝。
- [ ] 云函数调用只对已认证平台身份开放，匿名调用被拒绝。
- [ ] 业务角色、组织和关系权限在云函数内部再次校验。
- [ ] 日志脱敏、告警、备份和回滚责任人已明确。
- [ ] 本地配置和 CI 中没有真实密钥进入仓库。
- [ ] 通过 `m1-test-plan.md` 的权限、幂等、并发和回归门槛。
- [ ] M0 页面与内存 repository 仍可独立运行。

## 7. 官方参考（核验日期：2026-09-12）

- CloudBase CLI 配置文件：<https://docs.cloudbase.net/cli-v1/config>
- CloudBase CLI 安装与登录：<https://docs.cloudbase.net/en/cli-v1/install>
- 云函数安全规则：<https://docs.cloudbase.net/cloud-function/security-rules>
- 数据库安全规则：<https://docs.cloudbase.net/database/security-rules>
- 云函数访问 CloudBase 资源：<https://docs.cloudbase.net/cloud-function/resource-integration/cloudbase>
- 服务端数据库事务：<https://docs.cloudbase.net/en/database/transaction>

官方当前说明：云函数安全规则只提供调用门禁，不能表达项目内的学生/家长/教师/管理员细粒度角色；复杂授权必须在函数业务逻辑中完成。数据库事务只在服务端使用，因此任务发布、提交和点评的多集合一致性不得放在小程序客户端实现。
