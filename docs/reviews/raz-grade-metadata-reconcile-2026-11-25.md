# RAZ 年级筛选元数据补齐（2026-11-25）

## 结论

按 2026-11-25 22:07 生产读回盘点中优先级最高的 RAZ 元数据缺口，已为 145 本已发布 RAZ 阅读资源补齐目录筛选使用的顶层 `grade`，并同步两所学校各自的全教师投影，共更新 145 条来源记录和 290 条投影记录。

年级值没有重新推断：145 条来源和 290 条投影的 `payload.grade` 均为“三年级”，师生展示标题也都含“三年级”。此次将现有值复制到顶层 `grade`，供服务端年级条件查询使用。

## 生产变更

- 执行时间：2026-11-25 23:18（Asia/Shanghai）。
- 目标：阿里云生产 `/var/lib/yarei-v0128/business.sqlite` 的 `learning_resources`。
- 备份目录：`/var/lib/yarei-v0128/backups/manual/raz-grade-reconcile-20261125T1509Z/`。
- 备份校验：`business.sqlite` SHA-256 `86673d5c1622d485716820fa4b4d36946933c36b1122ef3b4434a048d57f8313`；`auth.sqlite` SHA-256 `33acf3d777d4ca36810154e37bc009d2ea690ab726cd2838c77474349f889085`；`jobs.sqlite` SHA-256 `ca1f791bb35e996539e1fbd01990445a9645e4698c6ec263cf883244e237af13`。三份备份的 `integrity_check` 均为 `ok`。
- 写入方式：短停 `yarei` 后通过 SQLite 单事务更新；每条来源/投影文档版本递增，投影 `globalSourceVersion` 与来源版本同步，保留原来源指纹关系。没有改动 `contentVersion`、正文、媒体、发布状态、授权范围或任务快照。
- 审计记录：`asset_metadata_raz_grade_20261125`。

## 独立读回

2026-11-25 23:19（Asia/Shanghai）生产读回结果：

- 145/145 来源记录和 290/290 投影记录的顶层 `grade`、`payload.grade` 均为“三年级”。
- 启航组织、隔离组织和雅睿组织各自均可按该年级筛到 145 本 RAZ 资源。
- 资源总数仍为 1,773；已发布 1,555、下架 210、草稿 8。已发布类型计数与 22:07 快照相同。
- SQLite `integrity_check=ok`；`yarei` 为 `active`；公网 `/healthz` 返回 `ok`、版本 `0.128.0`。

短停服务重启过程中，第一次健康探测在服务完全启动前返回 502；随后确认服务恢复为 `active`，独立 HTTPS 健康检查返回 200。没有重试数据库写入。

本次验证覆盖生产数据库字段、目录计数、投影关系、审计记录及健康检查；没有额外执行教师登录后的小程序页面点验或真机验收。
