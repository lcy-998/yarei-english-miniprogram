# M3 原生管理工作区非生产部署审阅包（2026-10-06）

**状态：用户已批准审阅包和后续四项管理员权限前置项。6 个受保护集合/索引、5 个函数和虚构教师管理授权均已完成；微信模拟器的已登录页面点验尚待确认。**

本审阅包承接原定路径：教师小程序“我的”→管理工作区→A-01—A-08。未新增登录入口或模拟授权。

## 审阅环境与当前状态

- 环境：`cloud1-d8ggzrwwedb786e41`，上海；CloudBase 返回 `NORMAL`、个人版、超限按量关闭、未开通付费、未计费。
- 首次只读预检确认现有 5 个原生管理函数未部署、以下 6 个集合均不存在。批准后，集合与索引已按执行补记创建和核验；五个函数现均为 Active，`Nodejs20.19`、20 秒、256 MiB、无触发器，环境变量键名与既有六键一致。
- 当月费用查询返回点数 0；截至审阅时累计 4,312 次函数调用、1,151,923,200 GB·秒。数据库读/写额度接口返回 0、数据容量字段 2、存储容量字段 34；这些 API 字段无法给出新功能的准确费用上界。超限按量关闭，配额耗尽时功能可能失败；本包不主张绝对零成本。
- 只读预检代码：`workspace/m1-cloudbase/tools/audit-m3-native-admin-preflight.mjs`。它只输出状态、计数和环境变量**键名**，不会输出密钥值或数据库记录正文。

## 待授权操作范围

仅在上述既有非生产环境，用既有虚构数据和一名虚构管理教师执行：

1. 创建下列 6 个集合，客户端访问均设为 `ADMINONLY`，并满足对应 10 项逻辑索引要求；CloudBase 自动生成的唯一 `_id_` 索引只读核验，不重复创建。实际只新增 6 个非 `_id` 索引；不删除、不清空或重建任何既有集合。

   | 集合 | 索引 |
   | --- | --- |
   | `native_admin_grants` | 唯一 `(organizationId, teacherId)`；`(organizationId, status)` |
   | `native_admin_operations` | 唯一 `(organizationId, actorId, operationId)` |
   | `native_admin_management_operations` | 唯一 `_id`；`(organizationId, actorUserId, operationId)` |
   | `native_admin_content_operations` | 唯一 `_id`；`(organizationId, actorUserId, operationId)` |
   | `teacher_media_records` | 唯一 `_id`；`(organizationId, ownerTeacherId, status)` |
   | `teacher_media_operations` | 唯一 `_id` |

2. 部署本审阅包的 5 个 CloudBase 函数：`native-admin-query`、`native-admin-command`、`native-admin-management-command`、`native-admin-operations-command`、`native-admin-media-command`。运行时 `Nodejs20.19`、入口 `index.main`、20 秒超时、256 MiB、无触发器；保留现有 6 个环境变量键及其当前服务端值，不轮换、不打印、不写入源文件。
3. 用户随后批准的前置项已执行：仅给虚构管理员 `usr_admin_demo_01` 增加 `textbook.manage`、`question.manage`、`task.manage`、`media.review` 四项 M3 权限；角色版本和用户授权版本各递增一次，写入一条专用系统审计。随后由 `NativeAdminGrantService` 使用实时核验的管理员角色，给虚构教师 `usr_teacher_demo_01` 在 `org_qihang_demo` 授予以下九项权限，范围限定为该组织：`dashboard.read`、`organization.manage`、`user.manage`、`authorization.manage`、`textbook.manage`、`question.manage`、`task.manage`、`media.review`、`student_work.restore`。写入授权版本、操作回执及授权审计。
4. 在微信开发者工具中以该虚构教师正常登录，从教师“我的”进入 A-01，再逐页只读检查 A-01—A-08。核验授权摘要、列表/空状态、返回路径、越权拒绝和管理入口在撤权后消失。Codex 不调用创建/编辑/停用、题库上下架、媒体审核/上架等管理写操作；A-08 不制造扫描、转码、版权或对位通过凭证。
5. 不修改旧函数、业务密钥、教师教学授权、任务/学生记录、既有网页后台或生产环境；不产生云存储上传、不提交体验版、不发布网页。

页面操作本身按用户后续在模拟器里的选择执行；A-07 停用任务/活动、A-08 审核或上架会改变业务状态，应在点按前单独明确选择目标记录。

## 精确函数制品

函数包已从当前工作树使用 M3 专用构建入口生成，未加入默认 M1/M2 构建清单。ZIP 内仅有 `index.js` 和 `package.json`；包内 CloudBase Node SDK 版本为 `3.18.3`。SHA-256 如下：

| 函数 | ZIP 大小 | SHA-256 |
| --- | ---: | --- |
| `native-admin-query` | 27,257 B | `8C38CAA54F4D478AFBD51E6D75060C597ED7573FFB6239D6F4BBC0CFE2AD8E19` |
| `native-admin-command` | 21,188 B | `A2ED2FB4C786FFEAA647376F9E0A54D48BA451A3F0C4ADF4398E8538B286165E` |
| `native-admin-management-command` | 24,794 B | `196A5FF06CDE0462937E17386C59BD9349768D41CD0C13F00226B924CE0E9CC2` |
| `native-admin-operations-command` | 22,277 B | `3C89A545FDF0A57C8FFEB305F52F99C70873F6E87413A92B24A043AF37CA02D2` |
| `native-admin-media-command` | 23,391 B | `068B4218939643779D1FAAD34FC29136381E0BE1F80FB7896B532D7D87784C4C` |

可复核 ZIP 位于 `workspace/m1-cloudbase/dist/native-admin-review/zips/`；对应运行配置片段为 `docs/m3-native-admin-functions-review.fragment.json`。任何源文件、运行配置、环境变量键或函数路由变化，都需要重建并重新核对制品哈希。

## 回退与验收留痕

- 部署前冻结当前 5 个函数“不存在”的状态。若部署后出现问题，把新函数 `$LATEST` 恢复为本地已测的拒绝入口（`SERVICE_UNAVAILABLE`），保留函数及审计，不删除新增集合、索引或业务数据。
- 撤销 `usr_teacher_demo_01` 的管理授权并验证现有页面会话立即失效；之后是否重新授予以用户是否继续模拟器验收为准。用户授权版本只递增，不回退。
- 只核对本批函数版本、路由、权限、ACL、索引、虚构教师授权、撤权拒绝和 A-01—A-08 只读页面；保留请求 ID、计数、结果和审计摘要，不记录密钥、手机号、录音内容或题目答案。
- 原生八页的逐项写操作、网页后台跨端数据一致性及网页入口停用不在本次部署操作内；仍须后续实际验收后按受控回退方案另行处理。

## 2026-10-06 执行补记

- 第一次增量创建停在 `native_admin_management_operations` 的重复 `_id` 索引请求；CloudBase 已自动创建 `_id_`，返回 `IndexOptionsConflict`。当时没有部署函数、写入文档或授予教师权限。
- 已把 M3 manifest 改为核验平台默认 `_id_` 索引，并将 `teacher_media_records`、`teacher_media_operations` 加入唯一的 M3 教师数据库 manifest。随后六个集合的读回均确认空集合、ACL `ADMINONLY`，原有 54 个集合保留；新增集合总数为 6。
- 实际读回显示 10 项逻辑索引要求，其中 4 项由 CloudBase 自动 `_id_` 索引满足；只创建了 6 个自定义索引。六集合的实际索引数分别为 4、3、3、3、3、2（含系统 `_openid_` 索引），整体核验通过。
- `native-admin-command` 的认证边界已补充：仅该授权函数接受教师 `mini-program` 会话或管理员 `admin-console` 会话；其他原生管理函数只接受教师小程序会话，管理员会话不能借此打开管理查询或管理页面。
- 上述调整后重新构建五个 bundle，当前函数 ZIP 哈希见本节表格；部署前脚本会再次校验哈希和函数均不存在。
- 部署后、写入管理授权前的只读复核确认五个函数 Active，六集合均可读且为空，ACL/索引与 `ADMINONLY` manifest 相符。授权回执和审计写入后，只有 `native_admin_grants`、`native_admin_operations` 与 `operation_logs` 出现本包的记录。当前费用接口仍报告个人版、超限关闭、未付费/未计费；月费用点数为 0。数据库额度字段随集合/索引创建增加，仍受关闭超限计费保护。
- 授权前最后核验发现虚构管理员 `usr_admin_demo_01` 虽有 `authorization.manage`、`organization.manage`、`user.manage`、`organization.read` 和 `student_work.restore`，但没有 `textbook.manage`、`question.manage`、`task.manage`、`media.review`。后端按现行最小权限规则拒绝它把这四项授给教师；`native_admin_grants` 仍为空，P-04 管理入口尚不会显示。没有通过直接写库、伪造管理员权限或削弱授权检查绕过此阻断。

权限前置项经用户单独批准后已完成。只修改 `usr_admin_demo_01` 的角色权限数组、版本、该用户的版本/授权版本和一条审计；不改密码、身份、组织范围或其他角色。随后通过 `NativeAdminGrantService` 给 `usr_teacher_demo_01` 创建 active、organization-wide、9 权限的授权，授予版本 1；写入授权回执和审计。读回状态：管理员 role/user/authz 版本为 3/3/3；教师 user/authz 版本为 8/7；目标角色、组织范围均保持原值；9 项授权全量匹配。`native_admin_grants` 一条、`native_admin_operations` 一条、两条操作审计。

## 尚待完成

微信开发者工具本地自动化连到 `workspace/` 后，已验证当前虚构教师会话在 P-04 页面取得有效资料、显示“管理工作区”入口；A-01—A-08 逐页打开均为 `ready`，数据加载结束，无页面异常。只读列表数量为 A-01 概览 2 班、A-02 2 班、A-03 20 个账号、A-04 1 条授权、A-05 3 条教材、A-06 9 道题、A-07 20 条任务/活动、A-08 3 条媒体记录。

逐页截图与自动化摘要位于 `workspace/m3-acceptance/2026-10-06/admin-pages/`；P-04 入口截图为 `P-04-profile.png`。Codex 未执行页面业务写操作，也未停用网页后台。模拟器后续重启后，登录会话不在当前缓存中，开发者工具目前回到 P-01；进行人工复核时，用现有虚构教师 `usr_teacher_demo_01` 正常登录，再从 P-04 进入 A-01。因该教师 user authorization version 已从 6 升至 7，旧登录会话需重新登录。

## 本地验证

- `workspace/`：`npm run check` 通过，289 个测试文件、1209 项测试通过；历史网页后台 11 个测试文件、49 项测试通过并构建成功。静态视觉检查输出既有提示：T-19 待审批、T-20/A-08 旧稿需修改；不影响本次原生管理工作区的主稿采用状态。
- `workspace/m1-cloudbase/`：`npm run check` 通过，153 个测试文件、787 项测试通过。
- CloudBase 部署包专项：5 项通过。默认构建仍排除原生管理函数；M3 包只能通过 `node tools/build-cloud-functions.mjs --native-admin-only --outdir dist/native-admin-review/functions` 显式构建。
- 后续执行补记：集合创建/索引读回已完成；Functions 部署和教师授权仍待执行。本地测试覆盖 default builder 和 M3 opt-in builder；新增 admin-console 受众只限 `native-admin-command`，其余 M3 管理函数保持教师小程序受众。

## 最终模拟器就绪补记（2026-10-06）

本节状态覆盖本文前面的计划/待执行文字：六个集合与索引已完成，五个函数已部署，`usr_admin_demo_01` 的四项权限前置与 `usr_teacher_demo_01` 的九项管理授权均已写入并审计。教师授权版本为 1；教师用户授权版本已从 6 升至 7。

- 修复了小程序重启后 `getUser` 仅依赖内存 `currentUser` 缓存的问题：现在从当前 `auth-session.getCurrentSession` 重新加载用户快照，再读取管理授权。客户端专项测试 3 项通过。
- 微信开发者工具 `workspace/` 模拟器中，P-04 虚构教师资料和“管理工作区”入口可见；A-01—A-08 均实际加载到 `ready`，数据加载结束，错误/异常数为 0。只读列表计数：A-01 2 班、A-02 2 班、A-03 20 账号、A-04 1 授权、A-05 3 教材、A-06 9 题、A-07 20 任务/活动、A-08 3 媒体。
- 页面截图与摘要见 `workspace/m3-acceptance/2026-10-06/admin-pages/`。没有触发任何页面管理写操作、A-07 停用或 A-08 审核/上架。
- 开发者工具自动化重连后，当前模拟器停在 P-01，未缓存教师会话；用户需用现有虚构教师 `usr_teacher_demo_01` 正常重新登录，再从 P-04 验收。Codex 未重置或显示该账号密码。
- 最终 `workspace/` 完整检查：295 个测试文件、1225 项测试通过；网页后台 11 个测试文件、49 项通过并构建成功。后端完整检查：153 个测试文件、787 项通过。模拟器八页已实际打开；用户对最终视觉/交互的验收尚待其登录查看。
- A-05—A-08 查询投影补充：活动标题从发布快照读取，列表增加中文状态标签。五个原生管理函数中只更新 `native-admin-query` 的 `$LATEST`，仍为 Active/20 秒/256 MiB/无触发器/六个既有密钥键；新版 SHA-256 为 `8C38CAA54F4D478AFBD51E6D75060C597ED7573FFB6239D6F4BBC0CFE2AD8E19`。调用同一只读数据服务核验 20 条 A-07 记录都有标题和状态标签；未写入业务记录。
- A-07 活动标题现从发布快照读取，A-05—A-08 状态标签已本地化；只读数据服务核验 20 条任务/活动均有标题及中文状态，A-08 3 条媒体摘要可读且无扫描/版权证据时审核按钮保持禁用。仅更新 `native-admin-query` `$LATEST`，哈希见本节表格；A-07/A-08 更新截图为 `A-07-updated.png`、`A-08-updated.png` 和 `A-08-readonly-summary.png`。当前模拟器停在 A-08 只读摘要，教师会话有效。

## 最终当前模拟器状态（2026-10-06）

- 微信开发者工具当前项目 `workspace/` 已停在 A-01 管理工作台；Automator 读回 `status=ready`、9 项权限、有效教师会话。P-04 个人中心截图显示标准“管理工作区”入口；已沿该入口到达 A-01。没有额外登录入口。
- A-01—A-08 在模拟器逐页加载通过、20/20 记录列表无载入错误、未捕获页面异常；全部截图见 `workspace/m3-acceptance/2026-10-06/admin-pages/`。A-07 活动标题与中文状态、A-08中文状态标签的查询修正在模拟器读回并更新截图；A-08 对缺少审核证据的条目仍禁用审核通过。
- A-01 账号数/任务数当前按服务规则显示“未记录”，没有伪造汇总数据。A-07 使用现存虚构历史记录，包含若干较粗糙的旧测试名称；本次没有改动任何任务或活动记录。
- 最终检查：`workspace/` 根 295 个测试文件、1225 项通过；历史网页后台 49 项测试通过并构建。`workspace/m1-cloudbase/` 后端 153 个测试文件、787 项通过。CloudBase query 数据投影只读审计通过。
- 自动化重连可能清掉模拟器内的登录会话；若界面返回 P-01，使用既有虚构教师凭据登录即可恢复 P-04→A-01，不要继续使用授权前的旧会话。
