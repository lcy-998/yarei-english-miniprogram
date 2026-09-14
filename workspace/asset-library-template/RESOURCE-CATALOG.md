# 英语资产资源表

> 自动生成时间：2026-09-11T08:22:26.319759+00:00  
> 机器目录：`library/catalog.json`  
> 版权策略：用户已确认本目录资料无版权问题

## 现有资源

| 资源 ID | 类型 | 标题 | 源文件 | 版本 | 处理状态 | 文字覆盖 | 待补齐 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| book-join-in-5a-2026 | textbook | Join in 英语五年级上册 | 2026Join in新五上电子课本26-6-26.pdf | v1 | needs_review | 97.0% | chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |
| book-join-in-6a-2026 | textbook | Join in 英语六年级上册 | 2026秋外研Join in六年级上册 英语.pdf | v1 | needs_review | 95.8% | chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |
| book-unknown-3a | textbook | 三年级英语上册（版本待确认） | 1.三年级上册英语课本电子版（最新正式版）.pdf | v1 | needs_ocr | 0.0% | ocr_text, chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |
| book-pep-7a-2022 | textbook | 人教版英语七年级上册 | 【人教版】七上英语 电子课本（根据2022年版课程标准修订）.pdf | v1 | needs_review | 99.3% | chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |
| book-pep-9a-2022 | textbook | 人教版英语九年级上册 | 【人教版】九上英语 电子课本（根据2022年版课程标准修订）.pdf | v1 | needs_ocr | 0.0% | ocr_text, chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |
| book-pep-8a-2025 | textbook | 人教版英语八年级上册 | 2025秋季人教版八上英语新教材官方高清彩版.pdf | v1 | needs_review | 98.0% | chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |
| book-pep-4a | textbook | 人教版英语四年级上册 | 人教版英语·电子课本·四上.pdf | v1 | needs_review | 100.0% | chapter_structure, chapter_audio, sentence_timeline, follow_read_text, structured_vocabulary, structured_questions |

## 未加入或未识别资源

| 所需资源 | 角色代码 | 当前状态 | 说明 |
| --- | --- | --- | --- |
| 教材 PDF | textbook | 已发现 | 仍需完成内容复核 |
| 章节/课文完整音频 | chapter_audio | 未加入 | 放入源文件后由流水线登记 |
| 句子点读音频或句子时间轴 | sentence_audio | 未加入 | 放入源文件后由流水线登记 |
| 跟读标准文本 | follow_read_text | 未加入 | 放入源文件后由流水线登记 |
| 单词标准发音 | word_audio | 未加入 | 放入源文件后由流水线登记 |
| 结构化单词库与音节 | structured_vocabulary | 未加入 | 放入源文件后由流水线登记 |
| 教材配套听力音频 | listening_audio | 未加入 | 放入源文件后由流水线登记 |
| 听力原文 | listening_transcript | 未加入 | 放入源文件后由流水线登记 |
| 结构化题目、选项、答案和解析 | structured_questions | 未加入 | 放入源文件后由流水线登记 |
| 逐题音频起止毫秒 | question_audio_mapping | 未加入 | 放入源文件后由流水线登记 |
| 视频配音素材、字幕与台词时间轴 | video_dubbing | 未加入 | 放入源文件后由流水线登记 |
| 绘本阅读内容 | picture_book | 未加入 | 放入源文件后由流水线登记 |
| 英语时文内容 | current_affairs | 未加入 | 放入源文件后由流水线登记 |
| 英语章节阅读内容 | chapter_book | 未加入 | 放入源文件后由流水线登记 |

## 维护规则

- 加入新文件后运行 `scripts\run-pipeline.ps1 run`。
- 本表由脚本生成；需要修正名称、年级或角色时编辑 `config/resource-overrides.json` 后重新运行。
- “已发现”不等于“可发布”；只有状态达到 `publish_ready` 才能进入产品发布流程。
