# 已发布资源年级格式归一化（2026-11-25）

## 结论

已把 10 组 VOA Listening Level 1 听力资源中明确的年级标签从“3年级/4年级/5年级/6年级”统一为“三年级/四年级/五年级/六年级”，并同步 10 条全教师投影。只做格式等价转换，不根据标题推断年级。

| 原标签 | 来源数 | 归一后来源标签 |
| --- | ---: | --- |
| 3年级 | 2 | 三年级 |
| 4年级 | 4 | 四年级 |
| 5年级 | 2 | 五年级 |
| 6年级 | 2 | 六年级 |

## 生产变更

- 执行时间：2026-11-25 23:36（Asia/Shanghai；生产主机 UTC 2026-11-25 15:36）。
- 目标：阿里云生产 `learning_resources`，10 条 VOA 来源记录及各 1 条跨校投影。
- 预写备份目录：`/var/lib/yarei-v0128/backups/manual/grade-form-normalize-20261125T1523Z/`。
- 备份校验：`business.sqlite` SHA-256 `5943ed8fb64f692676c860719ee29d3658b298aa6d0f772379381c6ef29bb0a2`；`auth.sqlite` SHA-256 `33acf3d777d4ca36810154e37bc009d2ea690ab726cd2838c77474349f889085`；`jobs.sqlite` SHA-256 `ca1f791bb35e996539e1fbd01990445a9645e4698c6ec263cf883244e237af13`。三份备份的 `integrity_check` 均为 `ok`。
- 写入方式：保持服务在线，通过 SQLite 写事务更新来源和对应投影；文档版本递增，音视频字段和 `contentVersion` 不变。
- 审计记录：`asset_metadata_voa_grade_normalize_20261125`。

## 独立读回

2026-11-25 23:37（Asia/Shanghai）读回确认：来源和投影中对应年级格式均已统一；资源总数仍为 1,773，已发布 1,555、下架 210、草稿 8；已发布类型计数与 22:07 盘点一致。SQLite `integrity_check=ok`，`yarei` 为 `active`，公网 `/healthz` 返回 `ok`、版本 `0.128.0`。

本次验证覆盖数据库来源/投影字段、总量、审计和服务健康；没有重新执行小程序页面点验或真机验收。
