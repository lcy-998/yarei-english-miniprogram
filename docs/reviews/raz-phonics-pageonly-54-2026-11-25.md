# RAZ 无音频读本 54 本按 page_only 发布（2026-11-25）

## 结论

RAZ Phonics 里没有原书 MP3 的 54 本（Decodable Passages 20 本 + Read-Aloud 34 本）已按产品既有的 `page_only` 例外发布：54 条主记录、108 条跨组织投影、54 条审计，`published` / `visibility=organization` / `teacherCatalogOnly=true`；统一带 `audioMode=page_only` 与 `audioAvailabilityNote="点读、跟读与示范音频暂未开放"`。生产读回 162/162（54 本 × 3 组织）通过。

## 为什么用 page_only

这批书在 2026-10-27 缺口矩阵里 `pairedAudioSha256` 为空——G 盘只有 PDF/页图，没有配对 MP3。产品门禁对这种情况有明确分支：`hasCompletePublicLearningMapping` 在 `audioMode=page_only` 时只要求章节页完整（页 id 唯一、页码 1..N 连续、页图/缩略图齐全、`role` 存在）和固定提示语，不要求章节音频与句段。因此按例外发布，而不是假装有点读。

## 本批内容

- **Decodable Passages 20 本**（Set 1—10 各 2 本）：每本 21—29 页，正文为成段的解码短文；页数多、单页文字量大。
- **Read-Aloud 34 本**（A Super Special Soup、Albert the Angry Alligator、Sharon's Shoes 等）：每本 11—17 页，图画书排版。
- 页面角色：第 1 页 `cover`、末页 `credits`、其余 `content`；页图 1600×2474，缩略图为 320 宽。

## 发布与读回

| 项 | 值 |
| --- | --- |
| 记录 | 54 主 + 108 投影 + 54 审计 = 162 份 |
| 媒体 | 1,888 个文件（944 页图 + 944 缩略图），273.7 MiB |
| 哈希 | `sha256sum -c` 1,888/1,888 一致 |
| 备份 | `/var/lib/yarei-v0128/backups/manual/business.sqlite.pre-raz-pageonly-20261125`（`662fd5914ba7b36e`） |
| 写入 | dry-run 预检无问题 → 短停服务单事务写入 → 恢复，`/healthz` 返回 `ok` |

读回：三组织教师目录均列出；详情页数 8—29 且页码连续、角色正确；`getReadingAudioMap` 返回 0 段（符合 page_only 预期）；`/healthz` 正常。

线上 RAZ 现为 **145 个标题、435 条记录**（145 主 + 290 投影），阅读类已发布资源 489 条；`dupTitles=0`（每个标题恰好 3 条记录：1 主 + 2 投影）。

## 已知限制

- **没有音频、点读、跟读与示范音频**：学生只能看页图自读，教师不能用跟读评分；提示语已固定写明，不构成“可跟读”的误导。
- **没有逐页中文对照**：跟读句段不存在，`translationText` 无落点；页面上也没有中文字幕。若后续需要双语，需要在页级新增字段并同步页面渲染，属于产品改动。
- **正文未逐页转写**：本批只核对了页序、角色和页图完整性，没有像解码读本那样逐页 OCR/人工核对正文；页图是原书扫描，学生看到的就是原页。
- 年级仍按三年级 / 入门映射；本地资产索引未改写。

## 剩余

- **Sound Symbol 58 本（有原音频）**：每页“音素 + 单词”（`spr / spring`），是拼读音素卡；按绘本发布价值有限，且和 Alphabet 一样卡在“连续朗读切页”上，建议先定内容类型再动。
- **Sound Symbol 2 本无音频**：同样可走 page_only，量小。
- Alphabet 27 本的点读边界缺陷（37/208 段偏宽/偏窄）仍待人工逐本标边界。

## 产物位置

- 载荷：`.runtime/raz-batch-pageonly/docs.json`、`files.json`
- 报告与脚本：`docs/reviews/raz-phonics-pageonly-54-2026-11-25.md`、`.workbuddy/raz_pageonly.mjs`、`raz-pageonly-readback.mjs`
- 回退：删除 54 个 `res_raz_dpass*` / `res_raz_ra_*` 与对应审计，媒体目录 `raz-phonics-20261125/<bookId>/` 可整目录移除；数据库可用上述备份还原。
