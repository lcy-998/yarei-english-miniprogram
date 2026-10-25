# 非生产业务密钥轮换审阅包（草案，2026-10-02）

> 由一次本机私有配置误输出触发。本包只依据代码引用、配置**字段名**及只读函数名单制定轮换顺序；不包含或读取密钥值/片段、环境 ID、账号或生产资料。**未执行轮换、云端修改或部署**。轮换涉及服务端配置及可能的身份映射，须按 `AGENTS.md` 对这一具体环境、动作与回退取得用户一次明确授权。

**执行状态（2026-10-02）**：用户暂不接受虚构账号重登及旧绑定码/预览失效，要求维持现状。本包仅保留为历史风险分析，**停止执行准备，不请求当前轮换授权**；六项密钥、本机私有配置、现行函数与会话均不变。零中断/双密钥迁移如有可行设计，只能单独提出候选。

## 只读核对与共同前提

- 本机 CloudBase CLI 为 **3.8.2**；只读环境列表显示唯一既有非生产个人版环境 `NORMAL`、未开启超限按量、未计费，函数列表 38/38 `Active`。本机 `cloudbaserc.json` 被 Git ignore，未纳入版本控制。上述状态不能证明六项旧密钥仍有效，因此按可能有效处理。
- 38 只现行函数均通过 `functions/shared/cloudbase-node-deployment-entry.ts` 调用 `readSecrets()`，初始化时要求**六项全部非空且合格**；即使业务只用其中一项，缺少任何一项都使该函数配置失败。以下“业务直接使用函数”与“配置清除范围”要区分：直接使用可较少，**最终从现行运行配置清除旧值的范围仍是全部 38 只 Node 函数**。
- 公开模板中新增的语音 Node 函数也列有同六个键，但云端语音函数数为 0；它们不属于此次现行 38 只的轮换对象。将来若获授权部署，必须直接使用轮换后的新配置，不能从历史模板或不可变旧版本带回旧值。
- 现行 38 名称：`activity-command`, `activity-query`, `admin-session`, `admin-task-activity-command`, `admin-task-activity-query`, `auth-session`, `content-query`, `learning-progress-command`, `learning-progress-query`, `learning-stats-query`, `maintenance-timer`, `notification-command`, `notification-query`, `organization-admin`, `parent-query`, `phonics-command`, `phonics-query`, `relationship-command`, `review-command`, `review-query`, `student-task-query`, `student-work-command`, `student-work-query`, `submission-command`, `task-command`, `task-query`, `task-recording-command`, `task-recording-query`, `task-template-command`, `task-template-query`, `teacher-student-command`, `teacher-student-query`, `teacher-textbook-command`, `teacher-textbook-query`, `textbook-admin-command`, `textbook-admin-query`, `vocabulary-evidence-command`, `vocabulary-evidence-query`。
- [CloudBase 官方配置文档](https://docs.cloudbase.net/cli-v1/functions/configs)说明 CLI 2.12.0 及以上可选环境变量 `merge` / `overwrite`，旧版配置可能整份覆盖。当前 3.8.2 满足版本门槛，**仍须在执行前核对实际命令选项与每只函数完整字段集合**；不允许用仅包含新一项的局部配置覆盖其他变量。先以只含字段名、是否非空及不可逆哈希摘要的审阅记录核对云端与本机，不输出值。
- [函数版本文档](https://docs.cloudbase.net/cloud-function/gray-release)说明不可变版本包含环境变量等配置。旧版本及灰度路由可能继续持有或调用旧值；轮换前后必须列出 `$LATEST`、版本及流量路由，限制旧版本访问。**回退流量到旧版本会重新使用暴露值，不是正常安全回退。**

## 六项变量、业务影响与批次

| 环境变量名 | 直接业务引用（全 38 函数仍需该字段初始化） | 影响与建议批次 |
| --- | --- | --- |
| `YAREI_QUERY_CURSOR_SIGNING_KEY` | `task-query`, `student-task-query`, `review-query`, `parent-query`, `teacher-student-query` 生成/校验分页游标 | **可单独一批**，但五只生产/消费函数须协调同一新键；旧游标失效，页面重新取第一页。随后将其余 33 只函数配置中的旧副本清除。 |
| `YAREI_BATCH_REVIEW_SIGNING_KEY` | `review-query` 生成、`review-command` 核验短期批量评语预览令牌 | **可单独一批**；两只函数同批切换，未发布旧预览作废，教师需重新预览并确认；不重复发布反馈。随后清除其他函数旧副本。 |
| `YAREI_BINDING_CODE_DERIVATION_KEY` | `relationship-command` 的确定性六位绑定码派生 | 与下一项**建议同批**更换；同操作 ID 的旧签发计划可能不再复现旧码，当前未使用绑定码须明确失效/重新签发。 |
| `YAREI_BINDING_CODE_PEPPER` | `relationship-command` 的绑定码摘要/验证 | 与上一项**建议同批**更换；旧未使用码的摘要无法由新 pepper 验证。只对虚构非生产码按授权规则处理，不直接删除家长绑定关系。其余函数配置副本仍须清除。 |
| `YAREI_BUSINESS_SESSION_ENCRYPTION_KEY` | `auth-session` / `admin-session` 签发，所有可信业务函数解密小程序或后台会话令牌 | **全 38 函数协调一批**，否则新旧实例交错会随机拒绝。旧令牌立即失效，四角色及后台重新登录；数据库会话与审计留存，不删除历史。可与主体摘要批次同窗口，但两者没有加密上的强制同批依赖。 |
| `YAREI_SUBJECT_PEPPER` | `auth-session` / `admin-session` 解析平台主体，所有可信业务函数 `actor-resolver` 复核主体摘要 | **暂不能简单改配置**：现有 `auth_identities` 和 `business_sessions` 以旧摘要索引/绑定。只换 pepper 将使现有四角色无法找到身份，即使重新登录也不能自动恢复。须先形成受控身份重绑定/双摘要迁移设计，核对可信原始平台主体来源、版本与回退；找不到可靠迁移路径就停止此项，不改旧值。完成迁移后全 38 函数同批切换并强制重新登录，另做跨组织与撤权验收。 |

上述“同批”指某项业务的生产/消费函数必须在受控维护窗口内一致更新，不代表一次对全部函数并发盲发。可单独轮换游标、批量点评、绑定码和会话四个业务族；主体摘要有独立数据迁移门槛。每一批只有在上一批四角色回归通过、旧版本流量为零且无新增费用时继续。

## 拟执行顺序与回退

1. **仅预检**：比对现行 38 只函数及其不可变版本/路由、六字段名与是否非空、CLI 3.8.2 的具体 `merge`/`overwrite` 行为、`cloudbaserc` 与云端所有其他环境变量键名、套餐剩余额度和临时管理权限；记录哈希摘要，不读取/输出值。核对现有审计、备份可用及测试虚构四角色能登录。
2. **申请具体授权后**，由有权限者在服务端密钥管理或受控配置中生成新值并记录版本标识；按上表从游标、批量预览、绑定码、会话依次选择批次。部署前先核对完整环境变量字段集合，避免 CLI 覆盖导致未列字段消失。每只函数更新后核对 `Active`、代码版本、变量键名/非空及无旧路由；在同批生产/消费未同步前暂停对应虚构测试调用。
3. **主体摘要单独停步**：只有身份迁移方案、源主体可合法取得、不会丢失或错绑既有身份、四角色及跨组织回归明确后再审执行。不能仅通过重置密码、清空会话或替换一行配置宣称完成。
4. **异常回退**：首先停止受影响函数的新请求或关闭测试入口，保留任务、关系、审计与旧版本供取证；优先用**新密钥**修正配置并前滚。旧不可变版本/旧值只可在经另行风险确认的紧急恢复中短时启用，启用即视为暴露继续存在，随后仍需再次轮换；不得把旧版本流量回退写作“安全轮换完成”。不删除既有 M1/M2 数据或真实账号。

## 每批验收与停止条件

- 学生：用虚构账号重新登录，按本人读任务/资源、提交或只读历史；旧会话被拒绝。家长：仅已绑定孩子反馈，跨孩子/解绑立即拒绝；新绑定码成功、旧待用码按宣布的失效规则处理。教师：授权班级任务与待点评列表游标可翻页，批量评语新预览可发布一次、旧预览拒绝，人工逐项评分不被改变。管理员：后台独立会话登录、授权读取/审计和撤权旧会话拒绝。四角色均做跨组织伪造、旧令牌及权限版本变化测试，核对无重复写入或数据丢失。
- 任一函数配置失败、`Active` 下降、已有角色不能以受控新会话登录、跨组织授权异常、旧版本仍接流量、CLI 擦除无关变量、出现费用/额度警报或无法安全迁移主体摘要，立即停止后续批次并进入上述回退路径；不通过关闭鉴权或恢复暴露旧值掩盖失败。

**未决授权项**：具体非生产环境及费用上限、六项新值的生成/保管责任人、主体摘要身份迁移方案、维护窗口和是否允许紧急短时使用旧版本。以上决定前本包保持草案，不执行轮换。
