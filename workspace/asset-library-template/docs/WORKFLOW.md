# 自动加工工作流

## 1. 增量入口

把资料放入根目录或 `inbox/` 后运行 `scripts/run-pipeline.ps1 run`。流水线扫描支持：

- PDF 教材和阅读资料
- MP3、AAC、M4A、WAV 音频
- MP4 视频
- VTT、SRT 字幕
- TXT、JSON、CSV、XLSX、DOCX 补充资料

脚本按相对路径和 SHA-256 判断新增、未变化或已更新，不移动源文件。

## 2. PDF 流程

1. 读取元数据、页数、尺寸和加密状态。
2. 提取全部页面文字，计算文字层覆盖率。
3. 文字覆盖率低于 20% 时标记 `needs_ocr`。
4. 有文字层时输出 `text/pages.jsonl`。
5. 按 `none/sample/all` 输出单词级归一化坐标。
6. 按 `none/sample/all` 输出网页 JPEG 页面图。
7. 自动发现 `Unit/Module` 候选页，但章节边界仍需人工确认。
8. 将双栏、倾斜文字、题目和词表加入人工复核队列。

OCR 使用 `-Ocr sample/all` 启动，支持 `eng+chi_sim` 中英文混排。OCR 完成后仍回到相同的 `pages.jsonl` 与归一化坐标格式，不形成第二套数据模型；OCR 结果始终标记为待人工复核。

每次增量处理会统计坐标越界与缺坐标页并写入 `NEEDS-REVIEW.md`。`scripts/build-coordinate-candidates.py` 可为这些页建立独立的 `review/coordinate-candidates/` OCR 替代稿；它不覆盖原始词坐标，也不自动通过点读验收。

## 3. 音频流程

1. 登记文件哈希、大小、格式和初始角色。
2. 有 FFprobe 时读取时长、编码和码率；没有时由本地 `mutagen` 探测 MP3/AAC 的时长和编码。视频技术审核仍需 FFprobe 或等效工具。
3. MP3/AAC 可进入内容复核；WAV 作为母版并标记需要生成上线格式。
4. 根据文件名和配置生成教材/单元候选匹配。
5. 取得听力原文或题目后进行时间轴切分。
6. 每题至少绑定一个主片段，逐题试听复核。

## 4. 人工复核门

自动化只负责技术提取和候选判断。以下事项不能跳过：

- 教材元数据和版本
- OCR 文本
- 双栏/旋转文字阅读顺序
- 章节边界
- 单词释义、音节和例句
- 题目、答案和解析
- 音频与教材/题目的真实对应关系
- 句子点读区域及时间轴

待办统一进入 `NEEDS-REVIEW.md`。完成复核后，应在对应版本的 `review/` 保存复核记录，并更新状态。

复核记录使用不可覆盖的 `review/approved-content-vN.json`，流水线校验后自动更新状态；不得手改 catalog 或 manifest。跨页、媒体和内容字段的版本规则见 `REVIEWED-CONTENT-PACKAGE.md`。

## 5. 发布导出

资产审核通过后再执行全页渲染和媒体转码。上线包使用：

- 页面：JPEG/WebP + 缩略图
- 正文、目录、题目、词库、坐标和时间轴：UTF-8 JSON
- 音频：MP3/AAC
- 视频：H.264/AAC MP4
- 字幕：WebVTT + JSON，每条 cue/句段必须含英文 `text` 与中文 `translationText`；缺译文不得上传为可布置素材

本地 `library/catalog.json` 可作为后续 CloudBase 内容后台的导入源，`exports/wechat/asset-index.json` 用于上传页面和媒体并回填 HTTPS 地址。发布过程不由本脚本自动触发。

索引同时登记 MP3/MP4 和源字幕文件，但未复核资源的 `deliveryStatus` 为 `blocked_review`。内容发布预演只选当前资源及复核记录中明确引用的媒体，不把整库音频一并上传；纯文本题目允许无媒体上传行。生成的数据库草稿含未物化的 `$assetKey` 引用，服务端须先回填私有文件 ID 和当前班级授权，再按项目流程发布。

小程序包内不放原始 PDF、WAV 母版或整册页面；仅保留轻量配置和必要占位资源。学生端通过资源 ID 查询 CloudBase 数据，并从云存储/CDN加载页面、音频和视频。
