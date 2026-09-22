# M1 CloudBase 设计与实施索引

M0 已于 2026-09-15 经用户审批通过，M1 现已开工。本目录记录 M1 后端设计、实施门禁和验证要求，不覆盖权威产品/交互文档；M0 页面及 memory repository 继续保留为回退基线。

| 文件 | 内容 |
| --- | --- |
| `environment-setup.md` | 环境准备、手动控制台步骤、命名与密钥边界 |
| `database-schema.md` | M1 集合、字段、索引、关系、软删除和 M0 映射 |
| `authorization-rules.md` | 四角色服务端授权、资源规则与越权案例 |
| `function-contracts.md` | 云函数 action、输入输出、错误码、幂等、事务和版本 |
| `teacher-student-bulk-csv.md` | TCH-001 严格 CSV 模板、行错误、筛选导出及账号创建边界 |
| `migration-and-seed.md` | 虚构内存数据迁移、对账、清理和回滚 |
| `m1-test-plan.md` | 权限、幂等、并发、弱网、回归与发布门槛 |
| `open-questions.md` | 必须由用户/负责人决定的事项与决策记录 |
| `console-runbook.md` | 已确定的腾讯云方案与逐步控制台操作手册 |
| `manual-operation-gates.md` | 从本地代码到登录、部署、规则、虚构种子与云端验收的人工操作门禁 |
| `templates/` | 不含真实环境 ID/密钥、不会自动部署的离线示例 |
| `../../workspace/m1-cloudbase/` | 隔离的本地 TypeScript 前置骨架、函数安全占位入口及 Vitest；不连接云端 |

权威顺序仍为 `DOCUMENTATION.md` 所定义顺序。本目录有冲突时服从 `product-requirements-core.md` 和 `page-interaction-spec.md`。

## 2026-09-20 状态校正

管理后台 A-01 至 A-04 已通过显式运行时接入 `admin-session` / `organization-admin` 客户端，默认仍安全回退 memory；本地后台检查为 5 个测试文件、33 个测试并完成生产构建。微信开发者工具人工回归尚未执行（当前工作机未安装工具），性能专项仍需预算确认。

当前权威基线为 0.18.0。M1 只实现 `product-requirements-core.md` 与 `page-interaction-spec.md` 已列出的 M1 切片；付费、云端部署、规则发布、种子导入、真实账号/内容和生产动作仍需各自的明确授权。

## 本地代码状态（2026-09-17）

`workspace/m1-cloudbase/` 已完成本地协议、可信身份/会话、会话 CAS、权限、幂等、审计、虚构种子 dry-run，以及任务闭环、组织/关系、基础页图阅读、单词和教师/学生/点评查询切片。16 个默认函数入口均已具备文档数据库持久化业务组合；部署 provider 只需提供 SDK/数据库、可信 token/摘要/ID/时钟与无状态签名能力，模块加载与未配置本地环境不触碰 SDK 或数据库，缺失能力安全返回 `SERVICE_UNAVAILABLE`。平台主体已收敛为 UID-only，OPENID-only 或 UID/OPENID 不一致均安全拒绝。组织/关系写入通过原子 UoW 同时提交业务、幂等、标准审计与并发 guard；用户级 `authorizationVersion` 保证授权变化后旧会话立即失效，自由文本原因不会进入审计日志。教师学员编辑、停用/恢复和转班现也由独立 `teacher-student-command` 严格入口承接，客户端不能注入 actor、组织、权限或 scope；批量导入/导出目前只生成严格本地 CSV 计划和安全结果，不创建账号或写数据库。独立 `admin-session` 使用后台专属 audience 与持久化会话槽，管理员仍不会出现在小程序角色选择中。

`TaskQueryRepository` 现也提供 `DocumentDatabasePort` 实现，覆盖教师任务、学生任务、点评和家长只读服务共用的任务、assignment、提交、反馈、教师授权和资源选项读取。列表查询固定使用 `organizationId + deletedAt`（以及状态/主体）条件，详情使用确定性文档 ID，并通过本地 fake database 验证租户隔离、软删除、深拷贝和平台错误映射；尚未执行任何云端查询或部署。

`task-query`、`student-task-query`、`review-query`、`parent-query` 默认入口现在自动创建持久化查询 service，不再读取 provider 注入的查询 handler。部署 capability 必须注入无进程状态的签名分页游标 codec；`review-query` 还必须注入与点评命令共享配置的批量预览签名 codec。任一必要签名能力缺失即安全返回 `SERVICE_UNAVAILABLE`，本地实现不提供硬编码密钥或进程内 Map 回退。

小程序当前已新增 P-03、P-04、S-02、S-03、S-04、G-02、T-02、T-03 的本地可运行切片，并完成 content-query、learning-progress、家长孩子关系、教师学员查询、退出登录与多身份选择的客户端契约映射；默认仍保持 memory 回退，不会隐式连接云端。CloudBase 启用已建立默认关闭的显式启动门禁：必须同时提供精确 envId、`@cloudbase/js-sdk` v3 client port 与会话上下文；同一 SDK app 执行 Auth v2 密码登录和结构化函数调用，条件不足、能力不完整或初始化失败时不触碰真实云调用，也不会把旧 memory 会话作为业务 token。独立管理后台 A-01 至 A-04 已通过显式运行时接入 `admin-session` / `organization-admin` 客户端，默认仍安全回退 memory。2026-09-22 管理后台本地检查为 5 个测试文件、33 个测试并完成生产构建；全 workspace 为 69 个测试文件、423 个测试；微信开发者工具 CLI 已成功打开项目并进入自动化模式，最终可视路径、双尺寸、Console/Network/Storage 与弱网人工回归仍待用户验收，性能专项仍需预算确认。

本地已可将同一 TypeScript 源码构建为 16 个独立 CommonJS 云函数包。每包根目录固定为 `index.js`/`package.json`，内部代码已 bundle，客户端联调使用 `@cloudbase/js-sdk@3.9.3`，云函数运行时改用服务端 `@cloudbase/node-sdk@3.18.3` 读取调用身份与数据库；入口安装既有 deployment provider，部署模板统一使用 `Nodejs20.19` 与 `index.main`，并通过 CloudBase 2.0 动态变量为每个函数声明六项本机私有密钥占位。构建不登录、不部署，并由结构、函数日志卫生与无凭据值扫描测试保护。2026-09-19 `npm run check` 通过 47 个测试文件、294 个测试；`npm audit --audit-level=moderate` 因官方服务端 SDK 的传递依赖报告 5 项漏洞，自动强制修复会降级到破坏性版本，暂列风险不强改。

开发环境 ID 与六项独立开发密钥已在用户单独授权后写入本机受 Git 忽略的 `.env.local`；开发环境别名已调整为 `yarei-m1-dev`。经规则发布专项授权，19 个空集合曾统一为 `ADMINONLY`，两个新增进度集合的唯一索引已核验；2026-09-19 为真实会话持久化补建 `business_sessions`、`business_session_slots`，并补齐 `business_sessions` 主查询索引，本地清单更新为 21 个集合。六项密钥在详情核验触发安全轮换后重新注入；经用户单独授权，全部 16 个函数已通过 ZIP 直传部署并只读确认为 `Active`，后续又以服务端 SDK 版本重新完成 16/16 函数 ZIP 部署。匿名 JS SDK 调用逐个返回 `MISSING_CREDENTIALS`，未进入业务函数。八个虚构账号已创建、核验并在本机物化为两份受 Git 忽略的 runtime 种子包；2026-09-19 经用户授权后，非生产日志服务已开启并完成脱敏抽样，两份运行态虚构种子已受控导入并 verify 成功（主组织 306 条、隔离组织 17 条）。已新增 `npm run cloud:smoke:auth` 已认证冒烟 runner：学生、家长、教师三类小程序角色和客户端数据库直连拒绝通过，后台管理员会话当前仍返回 `FORBIDDEN`，跨组织、撤权、主闭环、幂等、事务和精确回滚演练仍需执行并记录脱敏证据。因此不能标记为 M1 整体验收完成。具体人工门禁见 `manual-operation-gates.md`。
