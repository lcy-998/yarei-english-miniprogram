# 数字资产库规范

## 1. 设计目标

同一份内容包同时服务网站、微信小程序和后续管理后台。资产不保存页面交互状态，而是提供播放器、点读、跟读、题目对位和任务快照所需的稳定数据。

## 2. 资源状态

```text
discovered → extracted → needs_review → approved → publish_ready → published → offline
                   ↘ needs_ocr / blocked_error
```

- `discovered`：已发现源文件，尚未提取。
- `extracted`：完成技术提取，未完成内容复核。
- `needs_ocr`：PDF 无可用文字层。
- `needs_review`：需要确认元数据、正文顺序、坐标、章节或音频归属。
- `approved`：内容编辑复核通过。
- `publish_ready`：必要资产齐全并通过格式校验。
- `published/offline`：由产品内容管理系统维护；本地流水线默认不直接发布。

## 3. 稳定标识与版本

- 书籍使用 `book-*`，音频使用 `audio-*`，视频使用 `video-*`，补充资料使用 `supplement-*`。
- ID 不包含姓名、手机号或易变路径。
- 源文件 SHA-256 未变化时跳过重复处理。
- 同一资源源文件变化时版本从 `v1` 递增，旧版本保留。
- 网站/CDN 文件应使用 ID、版本和内容哈希，避免同 URL 覆盖缓存。

## 4. 书籍发布包

```text
library/books/<book-id>/v<version>/
├─ manifest.json
├─ text/pages.jsonl
├─ coordinates/page-0001.json
├─ pages/page-0001.jpg
├─ timelines/
├─ vocabulary/
├─ exercises/
└─ review/
```

`manifest.json` 至少包含：资源 ID、版本、标题、出版社、系列、年级、学期、页数、源文件哈希、文字覆盖率、处理状态、缺失项和生成时间。

页面坐标统一使用左上角原点、0—1 归一化坐标。跨行句子允许多个 `hitAreas`。

## 5. 音视频发布格式

- 教学音频：MP3/AAC，上线前记录准确 `durationMs`；制作母版可保留 WAV。
- 教学音频单条不超过 30 分钟或 100 MB。
- 视频：MP4，H.264/AAC，单条不超过 30 分钟或 500 MB。
- 字幕：WebVTT，同时建议保留 JSON 时间轴。
- 听力题映射满足 `0 ≤ startMs < endMs ≤ durationMs`。
- 音频自动匹配只生成候选关系，人工确认后才能成为正式题目映射。

## 6. 内容完整性

阅读书籍达到 `publish_ready` 前必须具备：

- 正文与章节结构
- 章节音频
- 句子级点读映射
- 跟读文本

单词级点读为增强项。三、四年级词条必须有结构化音节数组和展示串，学生端隐藏 IPA。

听力内容达到 `publish_ready` 前必须具备题目、选项、答案、听力原文、源音频、逐题主片段和有效边界。

## 7. 文件夹版权策略

用户已确认放入本目录的现有与未来资料均无版权问题。本地清单统一使用 `rightsStatus=user_confirmed_cleared`，不要求 Codex 再次逐文件询问版权；其他内容质量、格式和产品审核仍照常执行。
