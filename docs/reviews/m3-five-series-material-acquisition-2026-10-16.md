# 五类指定素材补全续作（2026-10-16）

## 用户确认与执行边界

用户在本任务中明确答复“我已经取得权限，把缺少的内容补全，然后上架”。这是一项针对前一条所列环球少年英语、新时空英语、阅读探索者、Phonics Monster 1 和 SSS 儿歌的项目负责人使用权确认；不伪造出版方合同号、逐册版次或文件来源。依主项目 6.9 节，可在逐项内容审核、可完成性和发布预检通过后直接发布教学资料。当前同一 CloudBase 环境已列为拟生产目标，测试候选不得因曾经的非生产状态自动进入全教师目录。

## 来源与内容进度

| 项目 | 本轮可核对结果 | 现状态 |
| --- | --- | --- |
| 环球少年英语 | [圣智学习国内产品页](https://www.nglearning.cn/ow.html)只提供系列介绍并引导联系学术代表；未取得与国内版 A/B 册相符的完整学生书或媒体 | 无可上架版本 |
| 新时空英语 | [圣智学习产品页](https://www.nglearning.cn/timezones/)未提供完整学生书直达文件，未取得对应级别原书与媒体 | 无可上架版本 |
| 阅读探索者 | G 盘此前有 7 个 Reading Explorer 3e **全球版**官方样章/脚本，均 `needs_review`；本轮核对 Foundations Unit 3 样章原 PDF（8 页，SHA-256 `2041522d19145440b2b3390cbf2ce032e58a9881eb3fcd10c40bba1ee54577fe`）并从[官方 Unit 3 音频页](https://www.eltngl.com/sites/readingexplorerseries/try-sample-unit/foundations/unit-3-audio)取得 A/B 两段 MP3。全球版内容不能直接写成国内《阅读探索者》整册。 | 来源候选；未上架 |
| Phonics Monster 1 | [A*List 第 3 版官方页](https://www.alist.co.kr/books/view.asp?bcode=06PM3E01SB)列 MP3、词表、答案和预览。实查下载按钮先调用登录检查，当前无可用官方登录或导出包；页面预览不等于完整课程。 | 无可上架版本 |
| SSS 儿歌 | 按 Super Simple Songs 理解；[官方单曲页](https://supersimple.com/song/hello/)提供 YouTube 播放和歌词，未提供可核验的发行母版文件。用户已确认权限，但当前未取得曲目原始媒体包及适合云端发布的版本证据。 | 无可上架版本 |

两段官方样章音频字节与哈希：`rex3efu03a.mp3` 为 2,154,305 字节、SHA-256 `a431743b62740700cbf2c02c62fc1be67c3f12f5cbe50cfe8ed6f46440aabe87`，时长 134.639 秒；`rex3efu03b.mp3` 为 2,086,751 字节、SHA-256 `85b3c7d9a0ba11c5dc9c60cea097d9f11097bdbb5d5202e2bbbde4b8932fad0b`，时长 130.417 秒。均为 MP3、44.1 kHz 双声道。G 盘增量流水线对两条文件分别返回处理 1、失败 0，未赋予 `publish_ready`。原 MP3 直接 ClamAV 扫描报告 `Data scanned: 0 B`，不作为有效扫描；随后将两条原字节放入无压缩 ZIP，ClamAV 1.5.4 读取 4.04 MiB、实际扫描 4.30 MiB、感染 0。音频实际朗读内容和页内句段边界尚未完成可核对听校，不能据文件名绑定点读或跟读。

针对 PDF 第 37 页 Nora Shawki 的 *Digging for the Past*，已在 `D:\app-cache\reading-explorer-inspect-20261016\foundations-unit3a-five-question-candidate.json` 暂存 5 道原创改编、自带作答背景的单选题。五题 ID 不重复、答案均在选项中、逐题标注来源，源 PDF 与候选 JSON 哈希分别已核对；题包明确标为 `candidate_not_published`，且标题标识为 Reading Explorer 3e 全球版，不冒充国内版。该暂存稿未进入 G 盘正式派生目录或云端。

## 外部状态变化与未完成项

G 盘在第二条音频增量流水线成功结束后从 Windows 盘符列表消失；之后 `G:\英语资产` 不可访问。为避免写入错误目标，已停止素材库及云端写入。恢复后须读回 `library/catalog.json` 与 `reports/last-run.json`，核对两条音频的最终登记状态，再把暂存候选迁入不可覆盖的 G 盘派生版本并继续审核。

其余三套国内教材和 Phonics Monster 1 的完整官方导出包、SSS 可分发媒体文件仍未取得；当前网页介绍、预览或账号入口不足以通过正文/媒体/学生可完成性校验。项目负责人使用权确认已记录，不再请求重复的逐批内容批准；还需要可访问的实际文件或出版方导出入口。不得把全球版样章、第三方盗扫或同主题原创稿标成指定国内系列。

本轮新增 G 盘来源音频 2、正式教学素材 0、云端上架 0、云端数据/函数变更 0；候选稿 1 组 5 题；直接 MP3 扫描不足证据 1 次、ZIP 实际覆盖扫描通过 1 次；音频内容听校、逐句映射、国内版对照、教师/学生页面验证均未完成。
