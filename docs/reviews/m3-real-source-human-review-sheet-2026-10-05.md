# M3 真实来源教学资产：内容审核工作单

> 本单覆盖每类 M3 教学场景的一套真实来源样本。**它是待审稿，不是已上架内容。**英语资产库规则要求逐页、逐句、逐词及逐题人工复核后，按不可覆盖的 `approved-content-vN.json` 记录；目录状态不能手改。此单不要求重新确认 F 盘资料版权，版权范围已有用户统一确认。

## 已经具备的证据

- 最新机器目录 **1351 项**：1 本真实绘本 `publish_ready`；1020 条音频、322 本书、7 条补充资料和 1 条视频仍 `needs_review`。
- 已审核绘本 `book-sbc-en-0008` 的官方发布包与现有非生产云端 **30/30 私有文件哈希相同**；两班教师内容服务可列出它和各自教材节选。微信已登录教师实际布置尚未点验。
- 最新真实来源选择清单：`F:\英语资产\library\derived\m3-source-only-review\v14\selection-candidate.json`，15 个教学场景、60 个源或候选文件，**60/60 哈希复核**；状态明确为待审核和待后端门槛。
- 三、四年级 Unit 1 原 PDF 节选已登记为独立待审书，13/17 页与原 PDF 渲染像素 **30/30 一致**；三年级 13 页 OCR、四年级 17 页文字层与页面图/缩略图均已生成。
- 《绿野仙踪》第 1 章按古腾堡原文 20 段和 5 幅原插图排成 8 页，PDF 文字读回 **20/20 段**；另有独立的 LibriVox 真人第 1 章音频。《彼得兔》原题与真人朗读、人教版课次音频、真实绘本短视频均有源哈希和本地技术候选。
- 短视频与两条真实音频完成了本地签名库扫描、转码、产物复扫的**候选**证据。视频有 9 条来自获批绘本文字的字幕候选，换页时长与原逐页真人音频最大差 46 ms。尚未完成云端导入器的可信收据核验、人工试听和 A-08 上架。

## 需要逐项人工核对的材料

| 资源 | 可看材料 | 审核人需要确认 | 当前状态 |
| --- | --- | --- | --- |
| 绘本阅读 | `F:\英语资产\library\books\book-sbc-en-0008\v1\review\approved-content-v1.json` | 已获用户审批；只需在小程序验证音频/点读/任务布置 | 库内通过，云端可读 |
| 原版材料 | `F:\英语资产\library\books\book-sbc-en-0030\v1\review\content-candidate-original-v2.json` | 《Feelings》能否归“原版材料”、适合年级/难度、7 页文字/真人朗读/句级热区 | 待审，不能上架 |
| 三、四年级同步教材 | `F:\英语资产\library\books\book-pep3a-unit1-source-excerpt\v1\review\content-candidate-v1.json` 与 `book-pep4a-unit1-source-excerpt` 同路径 | 版次、30 页 OCR/页序、章节、原课次音频逐页归属和句级热区 | 待审，不能上架 |
| 时文阅读 | `F:\英语资产\library\books\book-nasa-roman-original-article\v1\review\content-candidate-v1.json` | 来源文章事实、5—8 年级适龄、是否新增对应虚构测试班；原文 24 段、6 页尚无匹配真人朗读 | 待审，不能开放三/四年级 |
| 章节阅读 | `F:\英语资产\library\books\book-gutenberg-oz-chapter1-original\v1\review\content-candidate-v1.json` | 原文与 LibriVox J. Hall 录音版本逐句一致、8 页排版、适龄、句级音频时间轴 | 待审，不能上架 |
| 听力与习题 | `F:\英语资产\library\derived\m3-source-only-review\v1\pep3-unit3-listening-candidate.json`、`peter-rabbit-question-01-candidate.json` 与真人录音来源记录 | 确定用原教材题还是《彼得兔》原题；核原答案、原文、逐题音频片段起止毫秒 | 待审，题目不能布置 |
| 单词 | `F:\英语资产\library\supplements\supplement-pep3a-unit2-real-vocabulary\v1\review\content-candidate-v1.json` | 原词表的 grandma/grandpa/family、教材原句、逐词真人音频区间和候选音节；音频毫秒区间目前留空 | 待审，先前合成词音包已从学生目录下架 |
| 看视频／视频配音 | `F:\英语资产\library\derived\m3-source-only-review\v1\media\sbc-en-0008-subtitles-candidate-v1.json` 与 `technical-receipt-v1.json` | 25 秒真实来源视频内容、9 条字幕逐句时点、适龄、配音任务使用范围 | 技术候选，A-08 未审核 |
| 自然拼读 | `F:\英语资产\library\derived\m3-phonics-lesson1\v1\lesson1-content-candidate-v1.json` | 原 Lesson 1 六页中哪些是教师指令、哪些能成为学生练习；音频来源与答案规则 | 待审，不能用旧原创课程充数 |
| 课堂录音 | `F:\英语资产\library\supplements\supplement-sbc0008-real-recording-prompt\v1\review\content-candidate-v1.json` | 录音任务是否使用已审核绘本原句“I am singing.”及该页真人示范音，年级与人工评分规则 | 待审；新的录音任务用途不因原绘本获批自动通过 |
| 跟读／打卡 | 已审核绘本原句和真人示范朗读可作为跟读来源；打卡引用最终上架的真实阅读/词包/题目 | 跟读评分和活动条件要与发布快照一致 | 随上述资源及 M3 功能门槛验收 |

审核时请在对应来源上核实内容，明确“通过/驳回/需修改”及具体页、句、题或毫秒位置。收到审核结果后才能生成不可覆盖复核版本并运行发布预演。单纯说“全部通过”无法证明未听过的逐题片段、词音和字幕时间轴正确。

## 后端还要完成

**2026-10-05 用户新决定：**“不用审核，直接上架。”本工作单不再作为本次非生产虚构班级素材开放的前置人工内容签字要求，改为用户在小程序验收时记录问题。现有候选的源哈希和自动检查结果仍保留；空白的词音/听力毫秒、未核对的答案或字幕不能据此填成“已审”，也不能绕过安全扫描、转码、授权、连续播放和任务发布完整性。该例外在权威需求 0.65.0 中记录；常规后台尚无“待用户验收”发布路径；除下述单条受控例外，其余新待审资源尚未上架。

**执行补记：**《Feelings》作为单条受控例外，沿用已上云的 22 个原来源文件，直接标“待用户验收”开放给两个虚构测试班；22/22 云端哈希、学生目录和教师阅读选择服务 2/2 已核对。它在 F 盘仍为 `needs_review`，未伪称资产库内容审批通过；小程序教师实际布置和音频/点读仍待验。其余待审资源尚未开放。见 `docs/reviews/m3-feelings-user-acceptance-publication-2026-10-05.md`。

**录音提示补记：**从已审核真实绘本原句 `I am singing.` 建立的独立录音提示，也按用户决定标“待用户验收”进入两个虚构班级；源真人 MP3 与云文件哈希相同，教师任务资源服务目录已列出。没有新增录音文件或学生作答，已登录小程序布置/录制/检查未点验。F 盘原补充资料仍为 `needs_review`，其余媒体候选仍未上架。见 `docs/reviews/m3-real-recording-prompt-user-acceptance-2026-10-05.md`。

**原题补记：**《彼得兔》FairytaleQA 原第 1 题连同原故事前两句，作为“待用户验收”的教师人工评分习题进入两个虚构班级；原 CSV 哈希和文字复核，教师题库目录 2/2 可读。它没有真人朗读片段，**不能算听力题**；学生作答/教师评分仍待小程序实测。见 `docs/reviews/m3-peter-rabbit-source-question-user-acceptance-2026-10-05.md`。

资产库审核通过后，后台可信导入器需按源哈希和技术收据复核云端实际文件字节；A-08 由独立授权者审核上架，普通教师只读选择。听力/看视频/任务配音的连续播放、防快进、发布快照、学生提交和教师检查功能目前尚未完成云端与小程序闭环；旧六项业务密钥风险也未完成轮换审查。本单不能代替这些功能验收，也不授权付费、生产发布或真实学生资料处理。
