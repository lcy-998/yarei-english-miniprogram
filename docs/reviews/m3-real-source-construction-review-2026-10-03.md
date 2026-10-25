# M3 真实来源验收资产施工记录与待审包

## 当前结论

按 0.64.0 的“真实来源、资产库复核、后台上架、教师小程序实布置”口径，**尚未形成全范围可发布包**。本轮完成了真实源文件选择和源哈希核对，并将三项可定位到原题/原页/原音频的内容制成明确待审候选；没有把任何候选伪写为 `approved`、`publish_ready` 或学生可见。此前混合原创/合成审阅 ZIP 不计入本次完成数。

## 已制作的真实来源候选

`F:\英语资产\library\derived\m3-source-only-review\v1\selection-candidate.json` 是不可覆盖的 v1 选择清单：15 个 M3 场景映射 15 个唯一源文件或可追溯派生文件，逐项计算 SHA-256 并与机器目录源哈希核对；唯一已达 `publish_ready` 的来源是 `book-sbc-en-0008`。清单状态为 `pending_editorial_and_backend_gates`，不是发布包。源文件没有移动、覆盖或删除。

同版本目录内新增三份不含虚构题干或合成音频的候选：

1. `peter-rabbit-question-01-candidate.json`：FairytaleQA《彼得兔》CSV 的原题第 1 题与原答案，关联原故事第 1 节并校验答案在该节文本中。题型、适龄、人工评分规则与出处仍待复核。
2. `pep3-unit3-listening-candidate.json`：三年级上册原书第 34 页“Listen and circle”与实际课次 MP3 的来源和哈希。原音频全文、每题起止毫秒、原选项/答案尚未人工试听确认，数组刻意留空。
3. `pep3-unit1-vocabulary-candidate.json`：同教材原书第 83 页词表与真实单元词音 MP3。词面/释义、逐词音频边界、音节和例句未复核，词数组刻意留空。

这三份是**内容加工草稿**，不能直接导入题库、听力或词包。真实来源不等于现有机器 OCR 和自动匹配已经正确。

## 已审核绘本与云端后端

资产库唯一已批准的 `book-sbc-en-0008` 官方 CloudBase 发布预演通过，30 条待上传文件清单及数据库草稿已在 `F:\英语资产\exports\cloudbase\content-26018eb8d13bd340` 生成。该包的 10 张页图、10 张缩略图、9 条逐页真人朗读和 1 条整本真人朗读，与既有非生产云端绘本资源 **30/30 文件逐项下载哈希一致**，资源当前版本 5；本轮无需重复上传或覆盖。真实教师内容服务对三、四年级各一班的此绘本及其各自教材节选的目录/详情查询 4/4 通过。已登录教师小程序选择、布置、学生提交和教师检查未由本轮验证。

## 不能跳过的发布门

- 资产库标准流水线最近一轮处理 610、跳过 732、失败 0；1342 项中仍只有 1 项 `publish_ready`，其他 1341 项待复核。`Feelings` 和三年级教材的官方发布预演因 `NOT_PUBLISH_READY` 与 `REVIEW_REQUIRED` 拒绝。原版材料候选《Feelings》在自动内容草稿里目前标为 `picture_book`；若本次放“原版材料”，分类需要人工确认并生成新版审批记录。
- NASA Roman 原文章注明面向 5—8 年级，现有非生产学生只有三、四年级；不能默认向全部现有学生开放。此前五页 NASA/《绿野仙踪》新写短版与合成朗读不符合本次来源口径。原文时文和《绿野仙踪》原章仍需来源事实/版本、适龄、页图、真人音频和句级时间轴复核。
- 真实来源短视频有书页图及真人朗读的哈希来源记录，但未作为独立 `video` 资源进入资产库机器目录；字幕时间轴、格式/安全技术证据和 A-08 审核未完成。三类媒体任务仍缺后台扫描转码、审核上架、防快进和三端闭环。不能仅把文件上传到私有云就开放教师布置。
- 本机 Windows Defender 虽有命令模块，实际状态为 `AntivirusEnabled=False`、`RealTimeProtectionEnabled=False`、无签名版本；未启动扫描，也不能拿该机器冒充“已通过安全扫描”。没有启用付费云托管或第三方扫描服务。
- 为评估免费且不使用 Linux/WSL/Docker 的受控媒体处理，已从 [ClamAV 官方下载页](https://www.clamav.net/downloads)取得 Windows 1.5.4 便携 ZIP 到 D 盘缓存，并以同页 Cisco Talos 公钥校验配套 PGP 签名，得到 `Good signature`；ZIP SHA-256 为 `0D9E0228B2674137EA1A2853566C98A0278AD52AB2582C3D6DBD75373848C395`。但首次 `freshclam` 从官方数据库下载签名时连续返回 TLS 错误 60/35，最终退出码 1；签名目录只有未完成的状态文件。按照 [ClamAV 官方说明](https://docs.clamav.net/manual/Usage/SignatureManagement.html)，没有病毒数据库不能进行有效扫描。因此**没有执行扫描，更没有生成 clean 证据**，也没有以跳过 TLS 验证的方式绕过失败。便携工具留在 `D:\app-cache\m3-media-tools`，未安装系统服务、未改 F 盘原始文件。

### 2026-10-04 免费 Windows 媒体技术链恢复与复核

上述 `freshclam` 首次失败是历史尝试；随后用 [Cisco Talos 官方 CVD-Update](https://github.com/Cisco-Talos/cvdupdate) 1.2.0 在 D 盘取得官方 `daily.cvd` 28142、`main.cvd` 63、`bytecode.cvd` 339，未关闭 TLS 验证。ClamAV 1.5.4 加载官方库（3,628,118 条已知病毒）对原视频和人教版课次音频的**隔离副本**扫描均为 `OK`，标准 EICAR 测试文件被识别且扫描退出码为 1。两副本与 F 盘对应源文件的 SHA-256 各自相同，F 源文件不被扫描器改动。

从 [FFmpeg 官方下载页](https://www.ffmpeg.org/download.html)指向的 Windows 构建提供者取得 9.0.2 essentials ZIP，并对照提供者 SHA-256 `60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba` 核对。原真人朗读短视频实测 25.011 秒、H.264/AAC；在 F 库新建不可覆盖的 H.264/AAC 转码版本 `library/derived/m3-source-only-review/v1/media/sbc-en-0008-human-narration-h264-aac-v1.mp4`，339288 字节、SHA-256 `d6f2a8a90a31197348068207f5a3333358ac2e1e1ca195a5af16627d389f6eaa`，25.011 秒。**转码产物再次经 ClamAV 官方库扫描为 OK**。`technical-receipt-v1.json` 记录源/产物哈希、三份病毒库哈希、工具包哈希、3/3 扫描结果和仍未完成的审核门槛；独立读回校验了收据和产物哈希。来源选择清单不可覆盖升级为 `v2/selection-candidate.json`，17/17 引用哈希一致、15 个场景仍为 `pending_editorial_and_backend_gates`。

这一结果只证明**一条真实来源视频的本地扫描和转码可行**；后台可信导入器尚未核对收据和云端下载字节，视频也没有独立资产库目录项、已审字幕、A-08 内容审核或小程序教师任务。故没有改 `learning_resources`，不把它写成可布置或 M3 通过。其他 1018 条真实音频和可能的大视频未批量处理；本地 ClamAV 也不自动覆盖未来教师或管理员任意上传场景。

同法从人教版三上实际 Unit 3 课次音频保留源 SHA-256 `bd8aae944fa6d7a47687b0c50a2c2b3eab9582272ff2a20656e459ede8fa51bb`，建立不可覆盖 MP3 重编码 v2（30.859 秒，SHA-256 `111f0363ecc210d7748f27e8115127f07436a322893a109f76ba383ccfe3f63b`）及先扫描、转码、再扫描的 v2 技术收据。**复核收据时发现产物扫描汇总是 `Data scanned: 0 B`**，虽返回 `OK`，不足以证明 MP3 有效载荷受到检查。为保留原始证据而不覆盖旧记录，另写 `v3/media/technical-review-amendment-audio-v3.json`，决定 `insufficient_evidence`、禁止将 v2 收据作为 clean 上架依据；来源选择清单升到 v4，20/20 文件哈希可核，听力仍标安全证据不足和内容待审。没有因为该 MP3 的 `OK` 输出放松后台发布门。

随后将源 MP3 与转码 MP3 **各自单独装入无压缩 ZIP**，解包读回证明 ZIP 中唯一文件的 SHA-256 分别等于原源文件与转码产物；同一官方病毒库扫描两个 ZIP，数据扫描量分别约 507 KiB 与 299 KiB，均返回 `OK`；独立 EICAR ZIP 的 68 字节测试文件被检出，退出码 1。全套扫描由脚本重新运行、收集原始日志，写入不可覆盖的 `v4/media/technical-review-amendment-audio-v4.json`；v3 的不足记录保留供审计。最新来源清单为 `v5/selection-candidate.json`，21/21 文件可复核。该方案解决这两条 MP3 字节的**本地扫描覆盖证据**，但后台仍需核对归档提取哈希、云端字节和收据，原听力题与片段的人工复核/A-08/连续播放仍未通过。

### 真实原题与真人录音的第二条听力来源（2026-10-04）

资产库原有 FairytaleQA《彼得兔》问答 CSV 和分节原故事文本；[LibriVox《The Tale of Peter Rabbit and Others》](https://librivox.org/the-tale-of-peter-rabbit-and-others-by-beatrix-potter/)的第 1 轨由真人 Julian Pratley 朗读《The Tale of Peter Rabbit》。按用户要求把该轨原 MP3 添加到 `F:\英语资产\inbox\librivox-peter-rabbit\`，源 URL 与哈希 `6949f07f5234e789903c6089bbee70e8989701ad72dffaf08a6ee89960f02e36` 写入不可覆盖的来源记录；实测 322.026 秒、MP3。**尚未证明朗读版本逐句匹配 FairytaleQA 文本，也未确定第 1 题所在起止毫秒**，所以仅为候选。

按资产库标准增量流水线重新登记：本轮**新增处理 1、未变化跳过 1342、失败 0**，新资源 ID `audio-6949f07f5234`、源版本 `v1`、状态 `needs_review`；目录合计 1343 项，待复核音频 1019、书籍 318、补充资料 5，另 1 本绘本 `publish_ready`。源录音没有被重命名、覆盖或删除。额外制作 H.264/AAC 之外的 MP3 技术衍生版本 `library/derived/m3-peter-rabbit-listening/v2/peter-rabbit-human-narration-mp3-v2.mp3`；一次 v1 尝试在 Windows 子进程文本解码时失败，v1 输出保留为未验候选，v2 重新完整执行。v2 对源/产物分别构造单文件无压缩 ZIP，解包哈希与对应 MP3 一致；ClamAV 扫描数据量约 2.74 MiB / 2.12 MiB，均为 OK，EICAR ZIP 被检出。`technical-receipt-v2.json` 保留工具/病毒库/原始扫描日志和未完成门槛。来源选择清单升级到 `v6/selection-candidate.json`，26/26 关联文件哈希核对通过；问题、故事、真人录音仍须**人工版本比对、适龄评分、逐题试听和 A-08 审核**后才能进入教师目录。

### 真实来源派生视频正式进入资产库待审目录（2026-10-04）

为保留 F 盘源输入只读规则，资产库流水线新增**显式派生媒体声明**：只有 `config/resource-overrides.json` 白名单内、位于 `library/derived/`、路径不越界、文件 SHA-256 与技术收据一致的媒体才进入统一目录；未列名派生物仍被排除。四个有意义的路径/哈希/收据拒绝用例与旧测试合计 14/14 通过。对这条视频运行标准增量流水线，**新增处理 1、跳过 1343、失败 0**，登记 `video-sbc-en-0008-human-narration` v1，探测到 25.011 秒、H.264/AAC，状态仍为 `needs_review`。最新目录有 1344 项：音频 1019 待审、书籍 318 待审/1 通过、补充资料 5 待审、视频 1 待审。视频的官方 CloudBase 发布预演如预期因 `NOT_PUBLISH_READY`、`REVIEW_REQUIRED` 和独立媒体须走 M3 链路而拒绝，没有暗中上架。

同一真实绘本已审核的标题与八句正文、旧视频页图切换时长生成 9 条 WebVTT/JSON **字幕时间轴候选**，所有文字直接来自 `approved-content-v1.json`，候选覆盖视频 25.011 秒且哈希可查。它是按页切换估算的字幕边界，仍需真人逐句试听确认；不能因文字来源真实就声称字幕对位已审。来源选择清单再升为 `v7/selection-candidate.json`，28/28 文件哈希一致、15 个场景仍标待复核，教师媒体目录仍未上架该视频。

进一步逐项探测 9 条真实页音频与 9 个视频换页时长，最大绝对差 **46 ms**；不可覆盖的 `v2/media/subtitle-timing-audit-v2.json` 逐页记录真实音频 SHA-256 和时长差。来源清单升为 `v8/selection-candidate.json`，29/29 文件哈希核对通过。此项验证只能说明换页时长与源朗读轨接近，仍无法代替逐句人工试听。

## 2026-10-05 真实教材、章节与时文候选继续加工

- **同步教材**：三年级和四年级上册原 PDF 的 Unit 1 测试范围复制为不可覆盖的 13/17 页 PDF，来源记录含原书 SHA-256、原始页号与产物 SHA-256；原书和节选用相同渲染参数逐页比较，画面像素 **30/30 一致**。资产库标准流水线处理 2、跳过 1344、失败 0，登记 `book-pep3a-unit1-source-excerpt`、`book-pep4a-unit1-source-excerpt` v1；三年级 OCR 13 页，四年级文字层 17 页，30/30 高清页图与缩略图齐全，均为 `needs_review`。两份 `review/content-candidate-v1.json` 列全页文字和哈希，仍待版次、OCR、章节、原音频与句级坐标人工审核。
- **章节阅读**：从古腾堡 43936 插图原版 HTML 的 `Chapter_I` 到 `Chapter_II` 边界提取 20 段叙事和 5 幅原插图；一条原插图说明单列，不当成正文。新增 LibriVox J. Hall 单章真人 MP3（384.574 秒，源 SHA-256 `3202d74deec26c853c9b6c611247768a1e01550a3f199429d3372623e39ef1aa`），F 标准流水线处理 1、跳过 1346、失败 0，登记 `audio-3202d74deec2` v1 `needs_review`。独立 Windows 扫描/转码/复扫 v1 收据对源/产物与 EICAR 对照有有效非零扫描量。原文排版 v1 留作视觉历史，改进封面后的 v2 为 8 页，抽页目视核对，PDF 文字读回 **20/20 段**。来源链和文字核对写入 v3 凭证；资产库标准流水线处理 1、跳过 1347、失败 0，登记 `book-gutenberg-oz-chapter1-original` v1 `needs_review`，8/8 页图/缩略图及文字层齐全。待人工确认录音版本、适龄和句级时点。
- **时文阅读**：以前存 NASA Roman 原文章 ZIP 为源，24/24 段经规范化词序与原 HTML 对照、3/3 源图哈希核对；以前五页新写短文不计入本轮。原文排成 6 页 PDF 并从 PDF 读回 **24/24 段**，来源链有不可覆盖 v3 凭证；资产库标准流水线处理 1、跳过 1348、失败 0，登记 `book-nasa-roman-original-article` v1 `needs_review`，6/6 页图与文字层齐全。原资料注明 **Grades 5–8**，当前三、四年级演示班不自动获权；文章事实、适龄和匹配真人朗读仍缺审核。
- **拼读**：从 Open Source Phonics 原 544 页 PDF 精确复制 Lesson 1 第 1—6 页，第 7 页为 Lesson 2 起点；同渲染参数比较原/节选页 **6/6 像素一致**。`lesson1-content-candidate-v1.json` 保留原文与页哈希、明确教师指令/学生练习的编辑判断和音频仍待人工处理，不构成 S-06 课程发布。
- **原版材料**：`book-sbc-en-0030`《Feelings》新增 `content-candidate-original-v2.json`，只提出把另一部真实英文原作归入 `original` 类，7 页与源哈希复核，审批字段仍为空；原自动分类是 `picture_book`，该产品分类需人审核定。

最新资产库目录 **1349 项**：音频 1020、书籍 322、补充资料 5、视频 1 均 `needs_review`，仍只有 `book-sbc-en-0008` 一本 `publish_ready`。新增源、节选、技术收据与待审稿汇入 `F:\英语资产\library\derived\m3-source-only-review\v13\selection-candidate.json`，15 个教学场景、54/54 文件哈希一致，标为不得直接学生发布。资产库新增显式派生书/媒体白名单与来源收据校验，最新 **19/19** 单元/回归用例通过。逐项人工审核入口见 `docs/reviews/m3-real-source-human-review-sheet-2026-10-05.md`。本阶段**新增云端资源/文件 0、函数部署 0、教师任务 0、付费开通 0**。

### 从真教材和已审绘本生成两条独立待审课堂资源（2026-10-05）

三年级原教材第 83 页 Unit 2 词表和教材第 17 页原句确认了 `grandma`、`grandpa`、`family` 的词面及例句候选；音节和中文义项列为人工候选，原“Words in each unit Unit 2”真人词音 MP3 已登记。逐词起止毫秒**不猜测**，三个字段保持空。由原书、真人音频和词表页图哈希绑定的 JSON 通过资产库显式派生补充资料入口登记为 `supplement-pep3a-unit2-real-vocabulary` v1，`needs_review`；标准流水线**处理 1、跳过 1349、失败 0**。`review/content-candidate-v1.json` 保留三词编辑表单；官方 CloudBase 预演只报 `NOT_PUBLISH_READY`、`REVIEW_REQUIRED`，不会上传。

另从已获批准 `book-sbc-en-0008` 第 2 页逐字引用“I am singing.”及该页真人 MP3，建立独立课堂录音提示候选。资产库登记函数强制核对原书审批 SHA、原句逐字相同、页图和示范音频哈希；修改提示句的拒绝用例已通过。`supplement-sbc0008-real-recording-prompt` v1 经标准流水线**处理 1、跳过 1350、失败 0**，保持 `needs_review`，`review/content-candidate-v1.json` 留待新任务用途与人工评分规则审核。发布包生成器的本地录音草稿契约已经补齐，但当前官方预演同样因缺独立审批而拒绝。合成 M3 三词包在核对无当前任务引用后，以 CAS 事务精确下架，保留 68 名虚构学生历史，真实绘本两班可见；执行见 `docs/reviews/m3-synthetic-vocabulary-retirement-review-2026-10-05.md`。

当前机器目录 **1351 项**、仍只有 1 项 `publish_ready`；来源选择清单为 v14（15 场景、60/60 文件哈希正确），资产库 **25/25** 用例通过。本轮除下架旧合成测试词包外，**没有**把新待审词包、录音提示、视频或书籍上传/上架，也没有部署新 M3 函数。
- 跟读评分由用户自行验收；真实书的真人示范音频可作教学来源，但学生端评分闭环、质量和等待时长尚未验收。

## 后续执行顺序

先完成每项原文/原题/原音频的人工内容复核和版本化 `approved-content-vN.json`，由 F 盘流水线使所需书、音频、词包和题目进入 `publish_ready`；然后以后台可信导入器按哈希上传不可覆盖媒体和草稿，解决可信扫描/转码与 A-08 审核，上架并按当前班级成员授权；最后用已登录教师小程序逐类选入 T-06、发布，核学生完成、教师只读检查和家长结果。没有足够审阅或扫描证据的类型继续保持草稿。

本轮云端操作仅为只读核对；**新增云端文件 0、业务资源 0、函数部署 0、任务发布 0、费用开通 0**。未要求用户提供真实儿童录音。

## 2026-10-05 用户取消前置内容预审后的受控云端开放

用户明确答复“不用审核，直接上架”。权威基线 0.65.0 将此限定为既有非生产、虚构班级的真实来源样本先开放给用户验收；不得伪称人工审核通过，技术/安全/权限/映射/任务完整性仍保留。资产库目录仍 1351 项，其中 1 项 `publish_ready`；本轮流水线处理 0、跳过 1351、失败 0。新增派生视频收据一致性核对源文件哈希、非零扫描量、产物复扫和 EICAR 对照，26/26 资产库单测通过；此处只验证候选收据结构，不等于后台可信审核。

在唯一非生产个人版、关闭超限计费环境，分三份精确执行单开放已有真实来源材料：`book-sbc-en-0030`《Feelings》原页 7 张复用此前私有云 22 个文件，22/22 哈希读回、学生阅读目录与教师阅读选择服务两班均可见；已审核绘本原句 `I am singing.` 的独立录音提示复用已上云真人页音频，F/云哈希一致，教师任务资源目录可列；FairytaleQA《彼得兔》原题第 1 题及原故事两句作为主观习题，教师题库目录两班可列。三项均标 `pending_user_acceptance`/“待用户验收”，覆盖两班 68 名虚构学员；资源写入 3 条、审计 3 条，新云文件 0、函数部署 0、任务发布 0、费用开通 0。执行分别见 `m3-feelings-user-acceptance-publication-2026-10-05.md`、`m3-real-recording-prompt-user-acceptance-2026-10-05.md`、`m3-peter-rabbit-source-question-user-acceptance-2026-10-05.md`。

这些服务端目录证据仍**不是**老师已登录小程序的真实布置、学生完成或教师检查。原 PEP 词音起止毫秒、听力原题片段、视频字幕时点和 A-08 媒体技术上架仍缺；NASA 原文章年级为 5—8 且无匹配真人朗读，不能授权给现有三/四年级。旧混合合成 ZIP 仍不计本次真实来源验收。
