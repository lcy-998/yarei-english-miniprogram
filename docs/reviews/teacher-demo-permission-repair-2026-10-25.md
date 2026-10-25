# 虚构教师班级读取权限修复（2026-10-25）

## 范围与授权

用户明确要求通过 CloudBase CLI 在既有非生产环境中直接补齐 `13800138001` 对应虚构教师账号缺少的权限。目标环境为 `cloud1-d8ggzrwwedb786e41`，组织为 `org_qihang_demo`，教师为 `usr_teacher_demo_01`，目标班级为四年级 1 班 `cls_grade4_1`。未修改生产环境、其他账号、教师角色、其他班级授权或管理员权限。

## 修改

- 变更前，目标班级授权为 active、版本 2，已有 `task.read`，缺少 `class.read` 和 `student.read`。
- 通过 CloudBase CLI 获取短期临时凭据，在同一数据库事务内给该班级授权仅追加 `class.read`、`student.read`；授权版本升至 3。
- 同步将教师 `authorizationVersion` 从 9 增至 10、用户文档版本从 10 增至 11，使旧会话失效；教师需要重新登录。
- 在 `operation_logs` 写入成功审计 `audit:org_qihang_demo:direct_db_teacher_grant_20261025042821139_9c1bde73`。因当前无可用业务管理员会话，审计明确记录 `actorUserId=null`、`actorRole=null` 和来源 `user_authorized_direct_cloudbase_cli`，没有伪装成管理员操作。
- 修改前的授权、用户和角色快照保存在当前 Windows 用户私有目录：`C:\Users\18167\AppData\Local\Yarei\teacher-permission-fix-2026-10-25\direct_db_teacher_grant_20261025042821139_9c1bde73.json`，可用于精确回退。

## 预检与验证

- 执行前确认 CLI 唯一目标为正常状态的既有非生产个人版环境，`EnvPaid=no`、`EnvCharged=no`、超额计费关闭；数据库写额度查询值为 190。
- 事务按组织、教师、班级、角色、原版本与权限做精确前置校验；第一次事务因 CloudBase `TransactionBusy` 在读取阶段失败，没有提交。随后改为事务内顺序读取并成功提交。
- 事务后两次读回确认目标授权仍 active，保留原有权限并仅新增两项；权限版本为 3、用户 `authorizationVersion` 为 10；成功审计记录存在且明确标注直改来源。
- 三年级 2 班的既有授权未更改。两个班均已有 `task.read`；本次修复只处理学生列表缺少读取权限的问题。任务加载失败仍需用教师重新登录后的实际页面/云函数请求进一步验收。
- 本次未验证微信开发者工具中的任务列表和学生页交互。用户重新登录后可验证四年级 1 班学生列表；如任务列表仍无法加载，应继续检查该请求的云函数响应及当前部署版本。

## 用户复报后的继续排查（2026-10-25）

- 用户复报页面仍不能加载任务资源或学员列表。数据库中存在一条教师 `authzVersion=10` 的会话，因此旧版本会话不是唯一原因。
- CloudBase CLI 只读比对发现远端 `task-query`、`teacher-student-query`、`content-query`、`teacher-textbook-query` 的代码哈希都与当前工作区不符；远端分别最后更新于 10-03、09-28、10-21、10-16。T-07/教师任务资源页和 T-02 学员页使用这些函数。
- 用户已要求修复非生产环境。更新前保存各函数代码回退点：任务查询的远端包与 `D:\app-m3-cache\teacher\full-bundles\2026-10-03-central-v2\task-query` 完整匹配；其余三个远端入口代码和运行配置摘要保存在 `C:\Users\18167\AppData\Local\Yarei\teacher-function-repair-20261025T045032Z\rollback`。云环境变量值未写入回退文件。
- 通过 `tcb fn code update` 以 zip 方式部署四个当前工作区包。逐个读回确认状态为 Active，远端 `CodeInfo` SHA-256 与本地构建逐字节一致；Nodejs20.19、`index.main`、10 秒超时、256 MB 保持。项目配置将此前 `InstallDependency=FALSE` 的三个函数按当前 `cloudbaserc.json` 改为 TRUE；全部四个函数的六个环境变量值与 `auth-session` 当前配置一致。
- 定向回归通过：任务/学员服务 4 个文件 59 项；任务资源目录、教材及默认函数组合 5 个文件 27 项。CloudBase 环境未有函数日志可供验证本次用户失败请求；没有微信开发者工具可进行登录态页面实测。
- 当前数据库授权仍为 active，四年级 1 班已含 `class.read`、`student.read`、`task.read`；任务读取授权原已存在。本轮修复了陈旧云函数实现，但实际页面加载仍需用户重新打开页面后确认；如失败，必须按新的失败请求读取对应函数日志并获得页面错误码，不能把代码读回视为页面验收通过。
