# 字幕中英文对照补齐与线上更新（2026-11-24）

用户指出线上英语素材库的阅读字幕只有英文，要求补齐中文对照并更新线上；未上传的现有素材也补上，并在相应文档中加入“上传字幕须中英文对照”的要求。本轮只补字幕文本，不改媒体文件、权限、任务快照、小程序代码或微信版本。

## 1. 范围与格式

沿用现有代码中的字幕字段格式：英文 `text` + 经审核的简体中文 `translationText`（字符串，trim 后不超过 500 字符）。阅读跟读句段为 `learning_resources.pronunciation.segments[]`，音视频字幕 cue 为 `learning_resources.payload.teacherMedia.subtitleCues[]`；页面已按 `translationText` 点击切换中英文，未改前端。

只读盘点结果：

| 对象 | 资源数 | 句段/cue | 唯一英文文本 | 原中文对照 |
| --- | ---: | ---: | ---: | ---: |
| 线上已发布阅读 | 10 | 284 | 138 | 0 |
| 线上配音/视频 cue（含 4 条 offline） | 22 | 156 | 49（33 与本地重合） | 0 |
| 本地已审内容包的阅读句段/视频 cue | 29 包 | 205 | 189 | 0 |

本地未上传但已有英文字幕的 `book-sbc-en-0008`（8 句）与其余已审包一并补齐；3,466 项待复核候选中没有可据此直接发布的句级字幕，故不改其 `needs_review` 状态，也不新增上传或发布。

## 2. 译文产出与审核

- 将 343 条唯一英文文本拆成 13 个小批次（每批 16—28 条），由子代理只产出本地译文 JSON；没有子代理连接线上或修改源文件。
- 合并后逐条校验：343/343 覆盖，text 与原输入逐字一致（含大小写、标点、换行），无空译文、无超过 500 字符、无占位文本。
- Codex 抽检全部长段落、专名一致性及短句译文；统一 `Khalai` 译名为“卡莱”（4 处修正）。没有机器自动生成译文写入线上。
- 终稿映射：`final-bilingual-map.json`，SHA-256 `679c65889c5ce131e5ded99df19d2aee3dbf87d1ada87b14b07df0a0f2da5f77`。

## 3. 本地素材写入

为 24 个已审包目录新增不可覆盖旁车文件 `review/translations-zh-v1.json`（共覆盖 29 份审核包；同目录 v1/v2 审核包字幕条目相同）。旁车文件含源审核包文件名与 SHA-256、审核者 `Codex`、带时区时间、`text`/`translationText` 条目；不覆盖原 `approved-content-vN.json`、`manifest.json` 或 `library/catalog.json`。清单哈希见工作目录 `local-sidecar-audit.json`。

## 4. 线上受控更新

1. 先将译文映射与更新脚本上传到服务器私有目录 `/var/lib/yarei-v0128/readiness/bilingual-subtitles-20261124/`（0700/0600）。
2. 在 `business.sqlite` 副本上 dry-run，确认 10 个阅读资源、22 个媒体资源的全部句段都能按 text 精确匹配；无缺译时脚本才提交。
3. 短停 `yarei` 服务，在 `/var/lib/yarei-v0128/backups/manual/bilingual-subtitles-20261124/` 备份三个 SQLite 文件后，用单事务写入：32 份文档版本各 +1、`updatedAt` 更新，新增 1 条 `operation_logs` 审计（`bilingual-subtitles-20261124-679c65889c5c`），随后立即恢复服务。
4. 读回验证：线上未翻译阅读句段 0、未翻译字幕 cue 0、审计记录 1。HTTPS `/healthz` 正常。
5. 通过正式 HTTPS 接口以教师身份读回：`getReadingPronunciationSegments` 27/27 条带中文（例：Hello! → 你好！）；`previewTeacherAsset` 11/11 条 cue 带中文（例：Whoa! → 哇！）。登录会话已退出。

## 5. 文档规范更新

- `product-requirements-core.md` 6.9 节、`page-interaction-spec.md` S-04/S-07/S-14、`docs/m3-central-media-asset-contract-2026-10-03.md`：新上传字幕必须中英对照；历史无译文资源继续显示兼容提示。
- `workspace/asset-library-template/docs/ASSET-LIBRARY-SPEC.md`、`REVIEWED-CONTENT-PACKAGE.md`、`WORKFLOW.md`：字段格式与旁车文件约定。
- `G:\英语资产\README.md`、`AGENTS.md`、`docs/ASSET-LIBRARY-SPEC.md`、`docs/REVIEWED-CONTENT-PACKAGE.md`、`docs/PRODUCTION-CONTENT-GATE.md`：逐句 `translationText` 为发布门槛。

## 6. 边界与剩余风险

- 未做小程序真机点击字幕的中英切换验收；只读接口已证明字段对教师可见，历史页面链路未改。
- 本地旁车文件是版本化证据，现有资产流水线尚不会自动把它并入发布包；后续若从这些本地包重新上传，需由导入流程读取旁车或把译文写入新审核版本，不能把“本地已补译文”直接当成“已自动上架”。
- 未上传/待复核素材的版权、音频、题目、年级等原有缺口不受本轮影响，仍按 6.9 节逐项审核。
