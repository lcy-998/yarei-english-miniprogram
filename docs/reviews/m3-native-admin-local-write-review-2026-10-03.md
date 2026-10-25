# M3 原生管理本地写能力与非生产审阅清单（2026-10-03）

> 基线 0.62.0。本文只记录本地代码和下一次非生产审阅所需的精确范围，**不是云端部署、管理赋权、费用或网页退役授权**。所有账号、班级、任务和媒体试验只能使用统一虚构数据。A-01—A-08 手机主稿已获用户采用决定；运行截图对照、四张关键状态板、横屏和真机仍未验收。

## 当前本地动作与硬门槛

| 页 | 已有的受保护入口 | 本地强制规则 | 仍不可宣称完成的能力 |
| --- | --- | --- | --- |
| A-02 | `native-admin-management-command`: `createClass`、`updateClass`、`assignTeacher` | 每次按教师账号的独立 `organization.manage` 授权及授权版本重验；新班级仅组织范围管理者创建，编辑/分配须在全部目标班级范围内；目标教师角色、CAS、操作回执、同事务审计；本人分配拒绝 | 既有教师分配修改、班级停用与关联学员迁移、已登录页面和云端联调 |
| A-03 | 同函数 `updateUser`、`restoreWorkDraft`；`native-admin-query:listDeletedWorkDrafts` | 用户改名要求当前组织及其全部活动班级在管理范围；草稿恢复另需 `user.manage` + `student_work.restore`，七天截止精确等于删除时间加七天，原暂存路径/未提交/未清理、CAS、幂等和教师审计均核对 | 新建/停用用户、绑定关系、重置密码和真实恢复页面/云端证据 |
| A-04 | `native-admin-command:setGrant` | 独立 `authorization.manage`，不得本人自授；不得委派自己没有的功能或组织/班级范围；事务内再次核本人授权版本与目标 user/grant 版本，操作回执及审计 | 新获授权教师的实际赋权、撤权旧会话云端实测及页面视觉验收 |
| A-05 | `native-admin-operations-command:saveTextbookConfig` | 仅保存当前授权班级的同步教材**草稿**；资源和班级当前有效、CAS、幂等、审计 | 发布/停用及正式阅读内容审核、教师预览。草稿 `published` 不代表 M3 页音/点读/版权通过 |
| A-06 | 同函数 `setQuestionStatus` | 题目仅改上架/下架状态，题干和答案不在客户端可写；当前可见范围不能超出管理范围，发布核题型、题干、答案字段与解析；主观题允许答案为 `null`，CAS、幂等、审计 | 批量操作、纠错新版本、题目详情与实际页面 |
| A-07 | 同函数 `stopManaged`；`native-admin-query:exportRecords` | 只对本人管理范围内的课堂任务或打卡活动按当前状态停用；坏班级标识整体拒绝，保留历史提交/榜单；CAS、幂等、审计。导出仅当前授权任务/活动且最多 2000 条，CSV 防公式注入 | 任意筛选导出、任务/活动详情、网页与原生跨端对账 |
| A-08 | `native-admin-query:getMediaReviewSummary`；`native-admin-media-command:reviewMedia`、`publishMedia` | 只返回扫描/转码/版权/对位存在标志和数量，不返回私有路径或答案；审核员不能审核自己上传的媒体；既有 `TeacherMediaReviewService` 再核原文件扫描→转码→产物扫描的引擎/签名/时间/SHA 链、版权、映射、连续播放及独立授权；审核通过只到 `approved`，使用下一版本及另一操作号另行上架。缺真实证据时拒绝 | 真实扫描/转码处理器、费用上界、版权人工复核、逐题授权试听、驳回/下架完整联调和运行视觉对照 |

2026-10-06 补记：原生管理 query 与四个 command 已接入可信 CloudBase runtime composition，并通过独立的 M3 审阅构建路径打包；五个函数仍被排除在默认构建之外，非生产云端预检确认五个函数均未部署、六个集合均不存在。实际运行、授权及模拟器验收须按 `docs/reviews/m3-native-admin-nonproduction-deployment-review-2026-10-06.md` 获得一次明确授权后执行。**本地组合和测试通过不等于云端写入可用。** 旧 `organization-admin`/网页后台会话不作为原生教师身份使用。

## 集合、索引和客户端规则预检

执行前按 `workspace/m1-cloudbase/src/deployment/m3-teacher-database-manifest.ts` 核对，下列 M3 原生管理相关新增集合均须为客户端 `ADMINONLY`，不允许小程序直读或直写：

| 集合 | 用途 | 必需索引 |
| --- | --- | --- |
| `native_admin_grants` | 逐教师独立授权 | 唯一 `(organizationId,teacherId)`；`(organizationId,status)` |
| `native_admin_operations` | A-04 授权回执 | 唯一 `(organizationId,actorId,operationId)` |
| `native_admin_management_operations` | A-02/A-03 命令回执 | 唯一 `_id`；`(organizationId,actorUserId,operationId)` |
| `native_admin_content_operations` | A-05/A-06/A-07 命令回执 | 唯一 `_id`；`(organizationId,actorUserId,operationId)` |
| `teacher_media_records` | A-08 媒体审核记录 | 唯一 `_id`；`(organizationId,ownerTeacherId,status)` |
| `teacher_media_operations` | A-08 审核/上架回执 | 唯一 `_id` |

仍要核既有 M1/M2 集合：`users`、`classes`、`role_assignments`、`class_memberships`、`teacher_class_grants`、`learning_resources`、`textbook_catalog_drafts`、`student_works`、`student_work_operations`、`tasks`、`checkin_activities`、`operation_logs`。其中 `textbook_catalog_drafts`、`student_work_operations`、`operation_logs` 已有历史数据与既有索引，不能按新集合初始化或清空。原生新命令的 `native_admin_management_operations` 与 `native_admin_content_operations` 本轮仅更新本地 manifest，**未在非生产云端创建**。

## 下一次审阅包的实施与回退要求

1. **环境和身份**：只使用已核对的非生产 CloudBase 环境及虚构教师、跨班教师、管理授权者、审核员、学员、家长。先只读证明当前账号授权版本、班级范围、现行集合 ACL/索引、函数运行配置及旧业务密钥状态；不在命令或日志输出密钥值。真实教师账号赋权不在本包。
2. **制品**：从冻结工作树分别构建每只函数的完整依赖包，记录源文件/最终 ZIP SHA-256、函数名、运行时/内存/超时、当前 `$LATEST` 代码及配置摘要。当前尚无最终包哈希，不能据本文直接授权部署。旧函数先保留精确代码树/哈希；新函数保持 `invoke:false`、无触发器，直到专项审批确认。若现行函数或工作树变化，重新生成审阅差异。
3. **费用与配额**：执行前读取当天实际账单、个人版是否仍关闭超限、函数调用与 GB·秒、数据库读写/容量、私有存储及临时 COS 上传归属；为函数更新、受控虚构请求和回退给出可核的零新增费用上界。任何一项不确定或可能产生未批准费用即停步，不临时开通按量。
4. **最小顺序**：先发布安全集合/索引，再单函数代码更新和哈希读回，按 A-01—A-08 正常、越权、撤权旧会话、CAS 冲突、相同操作号重试和审计核对；每一页仅用本批精确创建的虚构记录。A-08 没有真实扫描/转码与版权人工证据时只验证拒绝，不生成 `clean/ready` 假回执或发布媒体。
5. **回退**：现有函数按已备份的完整旧代码树精确恢复并核配置、权限和路由；新函数禁用调用且保留可审计记录。仅回收本批新增虚构草稿/测试记录，不删除 M1/M2 历史、既有用户、提交或审计。集合、索引或安全规则回退需另列影响和顺序，不能靠删除整集合代替。

## 本地证据与未测

本地 `npm run typecheck` 与原生管理/媒体专项测试可证明接口和拒绝规则，不能证明云端、微信页面、真机、横屏或真实 AI/媒体质量。A-01—A-08 当前原生布局尚须按批准的 `current/A-01...A-08.png` 逐页截图对照；共用通用布局不算效果图通过。T-02 真 Auth 批量建号与错误文件下载、T-08 Qwen 云端建议、三类新媒体正式闭环亦独立保留缺口。微信订阅消息按用户决定延期，不在本轮测试范围。
