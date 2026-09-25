# M1 CloudBase 本地前置代码

此目录是 `雅睿英语` 的隔离 M1 本地实现，当前权威基线为 0.25.0，M1 已获用户批准开发交付验收。它不替换 M0 memory repository、不被小程序页面直接导入，也不包含真实环境 ID、账号或密钥。仓库代码本身不执行部署或数据导入；已获单独授权的非生产部署和虚构种子验证以 `docs/m1-cloudbase/manual-operation-gates.md` 的脱敏记录为准，遗留专项见 `docs/reviews/m1-final-acceptance-2026-09-25.md`。

## 本地运行

在本目录执行：

```powershell
npm install
npm run typecheck
npm test
npm run check
npm run build:functions
npm run seed:validate
npm run seed:plan
```

本包已固定安装 TypeScript/Vitest、`esbuild@0.28.2` 与官方当前维护的 `@cloudbase/js-sdk@3.9.3`。`build:functions` 在被 Git 忽略的 `dist/functions/` 生成 16 个独立 CommonJS 包；每包根目录只有 `index.js` 和 `package.json`。内部 TypeScript 全部 bundle，`@cloudbase/js-sdk` 与 `node:*` 保持 external，部署运行时由包清单安装官方 SDK。构建不会登录或部署；运行时只从 SDK 当前云函数上下文读取环境。首次实际 CloudBase 联调前，必须先完成本地门禁、代码审阅和用户允许的环境操作。

## 实现状态

- 已实现：`m1.v1` 线协议、严格顶层/深层 action schema、安全错误映射、可信 actor/业务会话、会话 CAS、组织/角色/教师授权/家长关系、关系命令幂等与拒绝审计、虚构种子 dry-run，以及 CloudBase runtime/document database port。
- 虚构种子已补齐纯本地 JSON loader、规范 SHA-256、集合级引用/同组织/敏感值校验和只读导入计划；示例的 hash 占位只在内存中准备。另有事务型 apply/verify/rollback 领域核心，以及最多 25 条/批的可恢复协调器：持久化 planned/applying/verifying/succeeded/failed/rolling_back/rolled_back 状态，完整 verify 前不成功，回滚仅删除本 run 未变更文档。运行态身份物化只接受 `sd1_` 摘要并强制与 fixture 身份一一对应；本机只读账号工具可核验八个虚构账号并在内存中把 UID 转为摘要，结果仅写入受 Git 忽略的 `.runtime/`。受控操作器只暴露六个单步命令，不提供自动跑完全程；其 CloudBase 事务桥、临时凭据启动器和本地端到端契约均已就绪，但不得在未获单独授权时执行任何云端导入。
- 已提供确定性权威规模虚构 seed 生成器：68 名学生、两个班级、36 个任务 assignment、27 份提交、6 份待点评，共 373 条关联文档；统计从底层记录重算，并通过同一 validator 与本地 apply/verify/rollback 合约。
- 云联调另提供两个独立派生包：主组织 306 条，保留 373 条权威包的全部业务闭环但只给学生/家长/教师/管理员四个 actor 保留登录身份；第二虚构组织安全包 17 条，用于四角色跨组织拒绝测试。两者使用不同 seedRunId 和完全隔离的文档 ID，共只需要 8 个虚构云账号。
- 已实现纯本地任务纵向切片：按班级或学员保存/发布任务、待开始任务完整更新、撤回/软回收、目标与资源快照、单次最多 500 人、阅读/单词/习题完成规则、学生草稿/提交版本、教师人工评分/退回及家长只读。50 人以内沿用单事务发布；51—500 人按 20 人分批建记录，完成前任务保持草稿且对学生不可见，中断可继续；云端容量与恢复验证仍待执行。
- 已实现纯本地组织/内容切片：学校/班级/用户安全视图、教师班级授权、绑定码与 5/3 上限、解绑即时失权，以及只返回已上架授权页图阅读/单词内容。
- 已实现教师任务、学生任务和点评的 11 个只读查询 action，包含当前授权复核、安全筛选、统计一致性、不透明分页游标及批量点评预览令牌。
- 已实现 `publishBatchComment`：短期预览令牌绑定教师/授权版本、任务版本、筛选、评语和实际 eligible 提交集合；发布时在同一事务逐条复核当前授权、提交版本和已有反馈，并原子写入点评、状态、幂等结果与审计，不覆盖已有点评或人工分数。
- 已实现 transaction-scoped document database port 与 `TaskCoreUnitOfWork` adapter：范围候选在事务外解析，事务内只按确定性 ID 复核组织、状态、软删除和版本；fake database 覆盖提交、回滚和竞态。
- 已实现可注入的 CloudBase server SDK 运行时桥接：每次请求从 `@cloudbase/js-sdk` Node Auth 上下文读取非空 UID 作为平台主体，不使用 OPENID 授权。小程序云模式统一使用同一个 SDK v3 app 执行 Auth v2 `signInWithPassword({ phone, password })` 与结构化 `app.callFunction`，由 SDK 自行传播登录态；函数请求只在严格 envelope 顶层携带不透明 `businessSessionToken`，密码不进入业务函数。部署侧可信 source 将 token 解析为内部 session，actor resolver 再复核平台主体绑定、撤销/过期和授权版本。客户端 actor、组织、角色及旧式 `sessionId` 注入仍被拒绝。document/query/transaction API 已绑定到既有 document port。16 个默认函数 `main` 已统一改为延迟组合：模块加载不访问 SDK/数据库，部署包安装服务端 capability provider 后才建立运行时；未安装 provider、缺少必要业务能力或初始化失败时继续安全返回 `SERVICE_UNAVAILABLE`。
- 小程序已建立默认 memory、显式注入环境标识、`@cloudbase/js-sdk` v3 client port 与会话上下文后才切换 cloudbase 的 repository/service factory；缺少任一项或 SDK 能力不完整时失败关闭并保持 memory。现有页面 import 和 M0 行为保持不变。T-06/S-09 已提供发布草稿、三类结构化完成数据、assignment/draft 版本及草稿跨刷新恢复，映射通过真实严格函数入口的本地端到端合约测试。
- 小程序已新增 M1 的 P-03、P-04、S-02、S-03、S-04、G-02、T-02、T-03：虚构环境支持找回密码演示、服务端身份选择、安全退出、基础词包、阅读目录与页图阅读、家长孩子关系、教师学员列表与学员详情；content-query、learning-progress、关系查询、教师学员查询与 logout 已映射到 service/repository 边界。多身份账号不会自动选择第一个角色；阅读/单词本地进度按用户隔离，CAS 冲突会刷新远端而不重放过期绝对值。阅读生产副本已压缩为 6 张 JPEG、合计约 0.44 MB，原始批准素材仍保留在视觉交付目录。
- 16 个函数均提供可注入的本地入口工厂、严格请求 schema 和统一默认持久化业务组合；小程序/后台身份会话、任务/提交/点评、四个任务查询、学习进度、内容、教师学员查询/命令、组织后台与关系命令均可复用现有文档桥，不再要求部署 provider 直接提供业务 handler。部署侧仍必须显式注入 SDK、数据库、可信 token/摘要/ID/时钟及无状态签名 codec，任一能力缺失均失败关闭。
- TCH-001 批量能力已提供纯本地严格 CSV 逻辑：固定 UTF-8 模板、最多 500 行、字段长度/手机号样式/班级范围校验、文件内和既有账号重复识别、公式注入拦截、带原始行号的安全错误 CSV，以及复用列表班级/关键词/状态口径的 UTF-8 筛选导出。导入结果仅为命令计划，不创建 CloudBase Auth 账号、不写数据库；后续账号创建和实际批量写入必须走独立受保护流程。
- 已新增 `TaskQueryRepository` 文档数据库适配器，覆盖 `task-query`、`student-task-query`、`review-query` 和 `parent-query` 所需的任务、assignment、提交、点评、教师授权及资源选项读取。集合查询固定携带组织和软删除条件，详情使用确定性文档 ID；平台不可用统一映射为可重试的 `SERVICE_UNAVAILABLE`。
- 四个任务查询默认入口会自动创建上述持久化 service/handler，不再要求 provider 注入查询 handler。provider 必须分别提供无进程状态的签名分页游标 codec 和批量点评预览 codec；缺少分页签名能力时四个入口均保持 `SERVICE_UNAVAILABLE`，`review-query` 缺少批量预览签名能力时也整体失败关闭。代码不包含默认密钥或进程内 Map 回退。
- organization-admin 已实现 A-01 授权范围概览、班级新建/编辑/停用、用户新建/停用、A-04 角色授权列表与审计日志列表、角色授权/撤销和教师班级授权/撤销。只读入口严格使用 admin audience、可信 organization/permission/scope、最多 31 天的时间范围和有界分页；审计 metadata 仅返回固定白名单。写操作统一要求 expectedVersion、operationId 和审计原因，并执行管理员 permission/scope、幂等、版本冲突、自锁保护和敏感字段脱敏。
- organization-admin 与 relationship-command 已接入文档数据库原子 UoW：业务写、幂等结果、标准审计和确定性并发 guard 同事务提交。班级名、学号、有效绑定码、亲子 pair 及家长 5/学生 3 的上限不依赖未验证的唯一索引；用户级 `authorizationVersion` 在角色/教师授权变化时单调递增，使旧会话立即失效。自由文本操作原因不写入审计日志。
- 独立管理后台已提供 A-01 至 A-04 的页面，并已接入 `admin-session` / `organization-admin` 客户端。显式提供非生产浏览器 SDK 与环境 ID 后，页面登录、概览、组织/班级、用户、角色权限和审计读取及受支持写操作均走云端 action；未配置或会话失效时安全回退 memory，不隐式调用云端。密码重置和亲子绑定仍由专用后续流程承接。
- TCH-001 已新增教师授权范围内的学生资料编辑、停用/恢复和转班命令核心及严格云函数入口；事务内复核实时班级授权与聚合版本，幂等写入业务、审计和并发 guard，并在停用/恢复或转班时推进 `authorizationVersion`。CSV 批量能力当前只生成本地命令计划、安全错误结果和脱敏导出，不创建 Auth 账号或写数据库。
- 已实现本地部署构建：16 个包在冷启动入口安装既有 `bootstrapCloudBaseNodeDeployment`，从受保护的函数配置读取六项独立加密能力，不读取环境 ID；配置或 SDK 缺失时不安装 provider，默认入口安全返回 `SERVICE_UNAVAILABLE`。结构测试同时校验包数量、根文件、CommonJS handler、external 边界、Nodejs20.19 模板、函数日志卫生和无环境 ID/凭据值。
- 已在单独授权后安装并锁定官方 SDK、完成 CLI 登录、收紧 19 个空集合的客户端权限，并以 ZIP 方式部署全部 16 个函数；只读复核确认全部为 `Active`，匿名 JS SDK 调用逐个返回 `MISSING_CREDENTIALS`，未进入业务函数。八个虚构账号已创建、核验并在本机物化为两份 runtime 种子包。尚未执行：真实角色认证联调、云端验证码/密码重置、种子导入、真实日志抽样和 L2/L3 闭环。云端部署成功和本机物化均不代表这些剩余门禁已经通过。
- 已新增纯本地已认证联调计划器，覆盖四角色、匿名拒绝、跨组织、撤权后旧会话、客户端数据库拒绝、主闭环、幂等与事务共 14 个场景；账号只以别名表示，证据使用固定白名单并彻底掩码 requestId，不读取凭据或调用云端。
- 2026-09-18 本地验证结果：M1 CloudBase 类型检查与 47 个测试文件、291 个测试通过；全 workspace 为 67 个测试文件、409 个测试通过；管理后台为 4 个测试文件、28 个测试通过并完成生产构建。当前 16 个部署包均可离线构建，SDK 依赖审计为 0 项已知漏洞。这不代表 CloudBase 完整集成测试、微信开发者工具对最新页面的编译验收或 M1 整体验收已经完成。
- 2026-09-20 复核：M1 CloudBase `npm run check` 为 47 个测试文件、296 个测试通过；workspace `npm run check` 为 68 个测试文件、419 个测试通过；管理后台为 5 个测试文件、33 个测试通过并完成生产构建。后台管理员已认证冒烟仍为 `FORBIDDEN`，因此独立后台的 CloudBase 页面接入和 L2/L3 闭环验证继续保持未完成状态。
- 2026-09-20 后续联调已修复虚构管理员缺少后台读取权限的问题：v1 主/隔离组织种子已按 `migration_runs` 中的归属和内容摘要逐批精确回滚，v2 种子分别完成 306 条/13 批与 17 条/1 批的重新导入和 verify。六项开发密钥已轮换，16 个函数重新部署并均为 `Active`。学生、家长、教师、管理员的已认证冒烟、客户端数据库直连拒绝，以及主组织家长、教师、管理员对隔离组织目标的只读拒绝均通过；当前本包 `npm run check` 通过 47 个测试文件、298 个测试。主闭环、撤权、幂等并发、故障事务与容量验证仍未完成。
- 2026-09-20 主闭环修复与验证：已修复 CloudBase 缺失文档事务读取、幂等首写、反馈缺失预读和 `class_memberships._id` 映射问题，并补齐教师角色与班级授权的 `content.read`。云端主闭环已通过教师发布、学生提交、相同 operationId 重试单写、教师点评、家长读取反馈和测试任务回收；M1 CloudBase 本地检查为 47 个测试文件、299 个测试。
- 2026-09-20 撤权旧会话专项通过：管理员撤销教师班级授权后旧教师会话被拒绝，随后按最新版本恢复授权成功。后台 organization-admin 幂等首查已改为事务外读取，配合 CloudBase 缺失文档事务修复。当前剩余 50 人容量与性能专项。
- 2026-09-20 容量专项通过：修复可复用教师 session 的重复 slot CAS 后，50 名虚构学生发布成功、生成 50 个 assignment 并完成测试任务回收；性能压测仍需独立预算确认。
- 2026-09-20 管理后台页面接入：新增 CloudAdminService 与显式云端登录入口，页面在获得后台会话后复用 `admin-session` / `organization-admin` 客户端；默认 memory 回退保持不变。管理后台 `npm run check`：5 个测试文件、33 个测试通过并完成生产构建。
- 2026-09-20 验证状态同步：本机未安装微信开发者工具，无法将“微信开发者工具人工回归”记为已完成；仅完成静态类型/自动化检查。性能专项仍受 50 元月预算与额度告警确认门禁约束，未执行压测。
- 2026-09-20 后端补全：`organization-admin` 新增受审计、幂等和版本保护的 `updateUser` action，仅更新展示姓名并推进 `authorizationVersion`；管理后台 cloud client 已同步该 action，A-03 编辑不再安全占位失败。M1 本地测试随后更新为 48 个测试文件、300 个测试通过。
- 2026-09-21 非生产云端复核：重新部署 `organization-admin` 后，虚构管理员执行用户姓名更新并恢复原值的冒烟通过，版本递增和安全响应均通过；未保留测试数据变更。
- 2026-09-21 零预算性能基线：新增本地虚构种子生成/校验基准，12 次平均 42.74ms、P95 80.09ms；不访问云端，不能替代付费压测。
- 2026-09-21 预算门禁：非生产预算确认为 0，未执行任何可能产生费用的压测、并发扩大或付费环境创建；云端 API 性能验收保留为后续有预算时的门禁。
- 2026-09-23 当前状态校正：2026-09-22 的管理员 `admin-session.bootstrap` 在已部署非生产环境返回 `INTERNAL_ERROR`。本地错误映射修复与 3 项回归用例已完成，但未部署复测；因此管理员真实云端登录、依赖该入口的撤权/恢复路径、真机端到端、弱网/安全专项和云端 API 性能验收均不能标记为通过。此前主闭环、四角色、跨组织、撤权、50 人容量和后台用户更新的云端通过记录仍保留为历史证据。

## 未来接入点

小程序侧已在 `workspace/miniprogram/repositories/` 提供默认关闭的 CloudBase repository 分支；它只通过受控 invoker 将既有 service command 映射到函数 action。页面、WXML、Less、`app.json` 和 M0 domain/service 不直接导入本目录，条件不足时继续回退 memory。

不得复制或提交现有真实配置。新的本机配置只能从 `docs/m1-cloudbase/templates/.env.example` 建立为未提交的 `.env.local`，并在用户明确允许配置和联调前保持 `TCB_ENV_ID` 为空。
