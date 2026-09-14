# 英语数字资产库 Codex 工作规则

## 1. 开始工作前

每次处理资产前，必须完整阅读：

1. `README.md`
2. `docs/ASSET-LIBRARY-SPEC.md`
3. `docs/WORKFLOW.md`
4. `docs/WECHAT-INTEGRATION.md`
5. `RESOURCE-CATALOG.md`
6. `NEEDS-REVIEW.md`

若资产库规则与 `D:\app\DOCUMENTATION.md`、`product-requirements-core.md` 或 `page-interaction-spec.md` 冲突，以主项目权威文档为准。

## 2. 工作边界

- 根目录与 `inbox/` 中的用户源文件是只读输入，不移动、不重命名、不覆盖、不删除。
- 所有派生结果写入 `library/`；运行报告写入 `reports/`。
- 资源发生变化时创建新版本，不覆盖旧版本。
- 当前主项目仍是 M0。除非用户明确要求并且主项目里程碑允许，不把真实教材直接接入 `D:\app\workspace\miniprogram`。
- 最终交付目标是微信小程序。PDF、全量页面、音频、视频和 WAV 母版不得直接塞入小程序代码包；派生媒体进入云存储/CDN，小程序通过资源 ID 和 HTTPS URL 使用。
- 用户已明确确认：放入本目录的现有及未来资料均不存在版权问题。统一记录 `rightsStatus=user_confirmed_cleared`，版权不作为本资产流水线的阻断项。

## 3. 标准操作

用户加入新 PDF、音频、视频、字幕、文本或表格后：

1. 运行 `scripts\run-pipeline.ps1 run`。
2. 检查 `reports\last-run.json`。
3. 检查并处理 `NEEDS-REVIEW.md` 中的待办。
4. 只有正文、章节、音频、点读/时间轴和必要词条均通过人工复核的资源，才可将清单状态改为 `publish_ready`。
5. 每次处理后必须更新 `RESOURCE-CATALOG.md` 和 `library/catalog.json`；默认由脚本自动生成，不手工维护两份不一致的数据。

## 4. 不得猜测

- 不确定的出版社、版次、年级、学期、ISBN、教材地区或音频归属，写入 `NEEDS-REVIEW.md`，不得凭文件名强行确认。
- PDF 自动提取的阅读顺序、双栏词表、倾斜文字、艺术字、题号和答案不得直接视为正确。
- 音频不得仅凭相似标题自动绑定到题目；可以生成候选匹配，但逐题起止毫秒必须复核。
- 三、四年级缺少结构化音节的词条不得标记为可发布。

## 5. 完成说明

完成一轮工作时，报告：新增/跳过/失败数量、生成版本、OCR 待办、元数据待办、音频待分类、人工复核项，以及实际执行的验证。
