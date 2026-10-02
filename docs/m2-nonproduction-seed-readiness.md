# M2 非生产虚构联调种子准备

> 2026-09-27。增量包和受控操作器先在本机生成与校验，随后在已获统一授权的非生产云端完成 5 条虚构数据分批导入与只读验证；现有 M1 业务数据未因本包改动。产品和页面范围以 `product-requirements-core.md`、`page-interaction-spec.md` 0.27.0 为准。

## 本地可复核包

`workspace/m1-cloudbase/src/seed/m2-development-fixture.ts` 确定性生成 M2 增量包，并与 `createPrimaryCloudIntegrationSeedPackage()` 所代表的 M1 主组织虚构基线交叉校验。它固定引用 `seed_m1_cloud_integration_v4`、`org_qihang_demo`、`cls_grade3_2`、`usr_teacher_demo_01` 和 `usr_student_g3_01`，不新建身份、组织、班级、手机号或密码。另用独立 `seed_m2_local_addon_v1` 和 `res_m2_` 等 ID 前缀，避免覆盖原有 306 条主组织基线。规范 JSON SHA-256 包含 manifest（排除摘要字段本身）与所有集合文档。

在 `workspace/m1-cloudbase/` 执行：

```powershell
node tools/run-m2-development-fixture.mjs
node tools/run-m2-offline-seed-rehearsal.mjs
npx vitest run tests/seed/m2-development-fixture.test.ts --maxWorkers 4
npx vitest run tests/seed/m2-offline-operator.test.ts --maxWorkers 4
```

第一个命令只输出集合计数与摘要。第二个命令输出逐文档 ID/摘要和 M1/M2 run 摘要，在独立 `FakeDocumentDatabase` 中执行分批导入、完整 verify 和精确回滚，最后对比所有 M1 业务集合。两个命令均无云 SDK、环境 ID 或真实数据库入口，也不把文档写入仓库或 `.runtime/`。本地验证检查 M1 引用、ID 冲突、组织与 seedRunId、集合计数、摘要、禁止的外部媒体地址/敏感值、各资源边界，并通过真实文档 repository 的本地替身检查目录可见性。

| 集合 | 数量 | 作用和开放边界 |
| --- | ---: | --- |
| `learning_resources` | 2 | 一道已上架的虚构动物词汇单选题，供 T-15/T-18、模板和活动草稿引用；一条仅供 A-05 查看目录摘要的同步教材草稿。教材没有页图和正文，不能发布或进入学生阅读。 |
| `phonics_courses` | 1 | 三年级短元音 a 的虚构文本课程与练习题，仅当前班级可见；`audioFileId: null`，页面必须显示音频不可用。 |
| `task_templates` | 1 | 系统只读模板，冻结上述习题及完成/自动计分规则；使用时仍由服务端检查教师当前授权和资源上架状态。 |
| `checkin_activities` | 1 | 三年级 2 班的一份未发布草稿，只预填练习分数条件。本地文档替身中经正常服务发布可生成 36 人名单、题目快照和 6 个非休息日实例；云端联调仍须校对日期并实际走服务。 |
| `notification_events` / `notification_read_states` | 0 | 不伪造定时提醒或已读状态；任务发布/点评通知应由真实业务记录推导，截止与打卡提醒由受保护定时维护产生。 |

## 离线受控导入计划

`src/seed/m2-offline-operator.ts` 只接受具体的本地 `FakeDocumentDatabase`，并将 2 条 `learning_resources`、1 条 `phonics_courses`、1 条 `task_templates`、1 条 `checkin_activities` 按依赖顺序列为 5 条候选；两个零记录通知集合只列入计数，不写假记录。计划只公开 `_id`、单文档 SHA-256、总摘要、每集合计数和所依赖的 M1 run/本地逻辑摘要，不公开题目答案或正文。

离线入口仍只接受 `m2-offline-only`、`synthetic-only`、精确 seedRunId、requestId、操作者和 1—25 条批量配置，拒绝额外字段与任何云端用途值。六个命令为 `status`、`plan`、`advance`、`resume`、`begin_rollback`、`advance_rollback`。原默认路径要求 M1 run 成功；针对现存云端 M1 run 实际处于失败回滚的情况，新增**明确审阅**路径：核对失败 run 的完整文档摘要、版本、回滚游标和 306 条历史引用，以及 7 条当前仍有效依赖的逐条摘要、版本、归属和授权关系；每批前重验，绝不把 M1 run 改成成功。`plan` 还全量检查候选 ID 和本 run 归属集合无冲突；现有 M1 `learning_resources` 只读保留，不清空、不覆盖，同 ID 即使内容相同也拒绝。

后续每次 `advance` 只推进一个状态或一个批次。演练以每批 2 条完成 3 批：`planned → applying → verifying → succeeded`。每批内候选创建与 run 游标同事务提交；提交故障不留下半批。verify 逐批核验内容、归属和摘要，最后审计四个集合中所有属于本 run 的文档，缺少、多出或被修改均不能标记成功。失败后必须显式 `resume`，不能从头覆盖。精确回滚按创建记录逆序分批，在每步删除前检查所有剩余文档的归属、版本和摘要；外部修改时当前步零删除并保留失败游标，修复后可显式恢复。回滚后保留 `rolled_back` run 记录，不能用同一 run 再次导入。本地测试覆盖幂等调用、已有 ID 冲突、中途冲突与恢复、事务提交失败、归属集合多出文档、外部改动阻断回滚及 M1 数据不变。

## 云端前置与缺口

云端现状已用只读方式核对：M1 主组织 run 为 `failed/rolling_back`、版本 35、回滚游标 231、历史引用 306；其中 227 条仍带该 run 标签，另 4 条原引用已被后续业务修改并失去标签，75 条已移除。7 条 M2 实际依赖均存在且有效；审阅摘要为 `sha256:be24fd6fd53e0562cc4978f3b11fe7b107656ec96df4b5a580cda8979287e6bd`，若任一记录变化，受控操作器应停止。当前本地生成器含 307 条 M1 引用，不能用它的总数或摘要冒充云端 306 条现状。

已增加单独的非生产受控云端入口，并把云函数业务读取隔离部署至全部 38 个函数；M2 run 未成功时，候选资源在详情、列表、分页与事务读取中隐藏，避免半批数据进入教学流程。真实云端按 2、2、1 条分三批导入五条虚构文档，随后三批逐项校验及全量归属审计通过，run 为 `succeeded`；M1 失败 run 和 7 条现存依赖的完整审阅摘要前后相同。导入中拼读、模板和教师活动列表未显示候选，成功后授权角色可见；习题的负向探针因未指定班级不作为云端隔离证据，成功后指定班级的正向详情和目录通过。精确回滚尚未在云端演练。完整执行证据见 `docs/reviews/m2-nonproduction-execution-2026-09-27.md`。云端入口只使用临时凭据并逐步复核环境与审阅摘要，不修改 M1 run；不得越过操作器直接把 JSON 写入数据库。

当前包没有获得授权的拼读音频、教材页图或自主配音视频，故不能验证播放、教材阅读和作品提交。同步教材草稿不会被教师目录选中，避免把空页目录当成可用教材。活动草稿日期只是演示输入，发布前需按学校当天重新确认。已修复的通知读取层在本地能从仅有 `_id` 的 M1 任务与 assignment 推导任务发布通知；其发布时间固定在 2026-09-17，只能在通知查询的 90 天窗口内充当联调来源。窗口过后需通过正常服务新发布虚构任务，不得回填假通知。截止、打卡提醒与已读状态仍需独立云端流程验证。本包不代表上述页面或 M2 里程碑验收通过。
