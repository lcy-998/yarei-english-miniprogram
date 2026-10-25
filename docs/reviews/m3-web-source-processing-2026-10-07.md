# 网上真实来源素材采集与首批加工（2026-10-07）

## 子 agent 采集

- `F:\英语资产\library\derived\web-source-batch-2026-10-07-subagent\manifest.json`：ELLLO A1《Colors!》《My Family》两组真人听力，原站 10 题及答案；美国国务院 Raggedy Ann 第 2 章原 PDF 与真人朗读；NASA 2019 探测车命名视频及原站文字稿。共 4 项、14 个文件，清单逐项保存来源 URL、哈希、字节数和可用字段。
- `F:\英语资产\library\derived\phonics-source-batch-2026-10-07-subagent\manifest.json`：IEW《The Phonetic Zoo》官方 Lessons 1–7 样本，原 ZIP 完整性通过；选取 Level A Lesson 1 `ai/ay` 的卡片、教师说明、示范与纠错音频。原始包保持不可覆盖。

两组 ELLLO 题目的逐题音频边界、Raggedy Ann 的页图/句级映射、NASA 的完整字幕时轴仍缺，不把采集数量当成可发布数量。NASA 片源是 2019 年已结束的征名活动，不能作为当前新闻呈现。

## 主任务加工

从 [VOA Learning English 第 5 课](https://learningenglish.voanews.com/a/lets-learn-english-lesson-5-where-are-you/3168971.html)取得 60.643 秒对话 MP3、300.096 秒 H.264/AAC 视频和 16 页官方教案 PDF，原文件保存在 `F:\英语资产\inbox\voa-lesson5-2026-10-07-v1`。教案第 9 页原稿与官网对话一致。素材流水线处理 3、跳过未变化 1354、失败 0；通用原始文件仍各为 `needs_review`，组合内容包单独记录核验。

`F:\英语资产\library\derived\voa-lesson5-listening\v2\listening-activity.json` 是一项源对位完整的主观听力作业：学生听全段对话后写出 cook、relax、wash、sleep 对应房间，四个参考配对逐句来自官方教案；评分每组 1 分、由教师人工判定。整个 60.623 秒作为这一题唯一主片段，未虚构逐小题时轴。MP3 输出为 44.1 kHz 单声道 128 kbps、60.631 秒。源与重编码输出分别扫描、非零扫描量为 47.75 MiB 和 1003.45 KiB，均为 OK；同库 EICAR 对照检出。技术收据与来源清单保存原文件、输出、PDF、扫描日志及签名库哈希。五分钟视频只作为来源候选；独立字幕时轴未补齐，未放行视频任务。

`F:\英语资产\library\derived\phonics-ai-ay-classroom-2026-10-07\v2\lesson.json` 从 IEW 原卡第 4 页抽取 6 个 Level A 原词，附 `ai/ay` 规则、拼写音节、整课示范音与纠错音。它可供教师备课和文字拼读场景复用；整课 MP3 没有可靠逐词时间轴，因此不提供逐词点播或自动听写发布。

`F:\英语资产\library\derived\elllo-a1-source-exercises-2026-10-07\v1\exercise-bank.json` 将 ELLLO 两组原站题目整理为 10 道文本阅读理解题。每题的题干、选项与答案索引均从原站 JS 逐项核对，解释引用同组原站对话中能支持答案的句子；两组音频只作为来源证据，没有编造逐题音频片段，所以这 10 题当前属于文字习题，不冒充可发布听力。

`F:\英语资产\library\derived\raggedy-chapter2-reading-2026-10-07\v1\chapter.json` 保留美国国务院 Raggedy Ann 原章 5 页的页图、缩略图、逐页抽取正文和 448.822 秒真人章节朗读，各文件带哈希。整章词句较长，仍缺句级时间轴、点读热区和三四年级适配复核，只能用作源页阅读及后续章节场景输入，不列为完整 M3 点读书。

`F:\英语资产\library\derived\nasa-rover-history-video-2026-10-08\v3\video-activity.json` 从 NASA 原 MP4 的 EIA-608 字幕流提取原时轴，与原站逐字稿 PDF 核对后截成 34.601 秒历史科技短片。17 条字幕完整落在片段内；截取点早于已结束的征名活动邀请，标题明确标 2019 历史内容。源视频、PDF、重编码 H.264/AAC 成品均经非零安全扫描为 OK，输出及字幕带 SHA-256；关键画面抽样已目视核对。无配套题的视频任务本地媒体发布合约及跨校投影预演通过，云端上传和小程序播放尚未执行。

后端新增 `formal_reusable` 受控导入口径：完整来源/安全/映射通过者记录 `source_verified_reusable`，不显示“待用户验收”，也不冒称人工内容审核；不同学校的教师目录与受控投影规则同源。VOA 听力与 NASA 视频离线媒体发布合约及跨校投影预演通过。后端 TypeScript 类型检查、资产目录及公共分发两份定向测试共 8 项通过。用户于 2026-10-08 批准具体审阅包后，五个文件已上传且读回 **5/5**，两只窄范围函数已部署并读回；两条公共源与第二虚构组织投影已建立。两班教师目录/预览 **4/4**，服务层教师发布—学生连续播放/提交—教师检查点评各两类闭环通过，探针任务已回收；实际微信页面和真机仍未验。完整失败重试、额度、回退制品与剩余证据见 `docs/reviews/m3-web-source-formal-nonproduction-review-2026-10-08.md`。
