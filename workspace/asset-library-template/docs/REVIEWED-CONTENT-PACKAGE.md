# 已复核内容包与本地发布预演

资产流水线只提取候选。`library/books/<id>/v<源版本>/review/content-candidate.json` 用于编辑与试听，**不会**提高资源状态。经人工核对后，另存为同目录的不可变 `approved-content-v1.json`；下一次修订用 `approved-content-v2.json`，不可覆盖旧签名。填写复核者、带时区时间、与文件名一致的 `reviewRevision` 和 `decision: "approved"`。不能直接改 `manifest.json` 或 `library/catalog.json` 的状态。

## 阅读书复核字段

`approved-content-vN.json` 必须包含：

- `schemaVersion: 1`、`resourceId`、`sourceVersion`、`sourceSha256`、正整数 `reviewRevision`、`reviewerId`、带时区的 `reviewedAt`、`copyrightStatus`（`demo` 或 `verified`）。这些值须与源版本一致；同一 `reviewRevision` 的内容改变会被拒绝。
- `reading.category` 必须是项目接受的 `original`、`synchronized`、`picture_book`、`current_events` 或 `chapter_book`；`grade` 与 `difficulty` 必填。同步课本还须填写 `term` 和 `textbook`。可填 `unit`、`theme`、`searchText`。
- `reading.chapters[]` 的 `id`、`title`、`order`、`pageNumbers[]` 和 `audioSourceRelativePath`。所有 PDF 页恰好归属一个章节；章节音频必须是当前机器目录中已探测时长的 MP3/AAC。
- `reading.pages[]` 覆盖 PDF 每一页，含唯一 `id`、`pageNumber`、`role`（`cover`、`content`、`credits`）、已复核 `ocrText` 及页面图、缩略图的 SHA-256。正文页另需 `followReadText`、`audioSourceRelativePath` 和至少一个 `sentenceMappings`。每项映射含句子文本、归一化 `hitAreas`、当前页音频的 `startMs/endMs`；边界须合法且不超过实际音频时长。
- 可选 `reading.attachments[]` 逐项记录 `kind`（`subtitle`、`timeline`、`question_mapping`）、库内相对路径和 SHA-256。复核通过后，这些 WebVTT/JSON 也进入当前书的上传清单；自动生成的候选 VTT 不能未经试听就引用为正式字幕。2026-11-24 起，`sentenceMappings[]` 与视频 `subtitleCues[]` 每条均须同时给出英文 `text` 和经审核的简体中文 `translationText`（≤500 字符）；只有英文的字幕该单项保持待补，不得标为 `publish_ready`。存量已审包可用同目录不可覆盖的 `translations-zh-vN.json` 旁车文件登记逐条对照，字段沿用 `text`/`translationText`，并绑定源审核包 SHA-256。

绘本候选可运行 `scripts/build-review-candidate.py --root <资产根目录> --resource-id book-sbc-en-0008` 生成。它会保留封面/正文/版权页、源页图哈希和逐页音频，并把候选音频终点限制在当前探测时长内；多句页面的句内映射保持空白供人工切分。它不会填写审批结论、年级、难度或复核人，也不覆盖现有候选。重建候选时用 `--output-name content-candidate-v2.json` 等新文件名保留上一版。

## 版本和导出

补充资料可用相同审批头创建词包或题目草稿：

- `contentType: "vocabulary"` 的 `vocabulary` 对象需有 `grade`、`unit` 和逐词 `id/word/meaning/example/syllables`；每词提供当前目录中的 MP3/AAC 文件及合法 `startMs/endMs`。音节拼写拼接后必须还原目标词。词包可选填 `term`、`textbook`。
- `contentType: "exercise"` 的 `exercise` 对象按**一份源文件对应一题**提供 `grade`、`questionType`、`stem`、`options`、`correctAnswer`、`explanation`，并在复核头提供正整数 `contentVersion`。听力题另加 `listening.transcript/audioSourceRelativePath/startMs/endMs`，映射须在源音频时长内。开放问答 CSV 不能未经改编与复核就变成自动判分选择题。

词包与题目均先生成 `learning_resources` 草稿；音频引用进入同一上传清单，没有音频的普通题目可生成数据库单独草稿。独立教学媒体由后台资产库集中导入、加工，审核/转码/上架仍由项目 M3 服务承担；教师只从已审核上架目录选择。

重新运行 `scripts/run-pipeline.ps1 run` 时，程序读取最高复核版本的 `approved-content-vN.json`，按资源类型核对源哈希、页面图、媒体文件与内容规则，才将通过者标为 `publish_ready`。音频的独立复核需相同的身份/版本字段及 `contentRole`；视频还需 H.264/AAC 和安全扫描的技术复核记录。通用 CloudBase 草稿包支持已复核阅读书、词包和单题；独立媒体的后台导入、转码、审核与上架仍归项目 M3 链路。

`scripts/build-cloudbase-publish-bundle.ps1 plan` 无云端操作，预演通过后 `bundle` 才生成版本化本地包。包内 `storage-upload.jsonl` 包括页图、缩略图和复核书籍引用的音频，使用内容哈希路径；`database-template.json` 的 `{"$assetKey":"..."}` 需要由上传器递归替换为私有云文件 ID。数据库草稿包含真实章节、页面尺寸、OCR、跟读文本、句级映射、正确阅读分类和阅读进度页索引。班级范围与 `allowedStudentIds` 初始为空，必须由服务端按当前授权学员关系填充并验证后才能发布。

资源源版本由原文件哈希决定，复核版本由 `reviewRevision` 决定。内容版本与发布包 ID 同时包含两者；编辑已复核文本、坐标、音频或页面图时须增加复核版本并重新验收。源文件不移动、不覆盖；已发布任务仍沿用发布时的内容快照。

**注意：** 本地 `publish_ready` 只表示资产包通过离线校验，不代表 CloudBase 已上传、媒体已通过 M3 审核、小程序页面可用或可以正式发布。`F:\英语资产` 当前真实资源均没有 `approved-content-vN.json`，仍为 `needs_review`。
