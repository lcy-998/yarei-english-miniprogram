# RAZ Phonics 有原音频解码读本全部发布（2026-11-25）

## 结论

用户要求“把有原音频的做了”。`RAZ Decodable Books` 中带原书 MP3 的 64 本已全部完成加工并发布：64 条主记录、128 条跨组织投影、64 条审计，全部 `published` / `visibility=organization` / `teacherCatalogOnly=true` / `catalogScope=all_teachers`。生产读回 192/192（64 本 × 3 组织）通过，线上共 64 个标题、192 条 RAZ 记录、1,567 个句段、656 个页面。

本批（第三轮）新增 42 本：先分 6 组并行子代理逐页读图转写，再由主流程统一校验、补译、生成时间轴与音频片段，分四次写入生产（8 + 8 + 8 + 18）。

## 本批 42 本清单

| Book | 书名 | 页数 | 句段 |
| ---: | --- | ---: | ---: |
| 03 | Nan and Pap | 9 | 6 |
| 04 | A Nap and a Map | 9 | 8 |
| 05 | Sam and the Sap | 9 | 6 |
| 07 | The Tot and the Pot | 9 | 9 |
| 08 | Don and Dots | 11 | 15 |
| 10 | Get the Pets | 9 | 12 |
| 11 | Hot at the Dam | 11 | 20 |
| 13 | A Fat Hat | 11 | 16 |
| 14 | Get the Gag | 11 | 18 |
| 15 | Ten Pets | 11 | 17 |
| 24 | Win a Wig | 11 | 26 |
| 25 | Nat's Cat | 11 | 27 |
| 26 | Jig, Jag, and Jog | 11 | 17 |
| 28 | Bub and the Nut | 11 | 16 |
| 29 | Vin and Val | 9 | 16 |
| 30 | Yum, Yum Yams | 9 | 16 |
| 31 | Jill and Bill | 13 | 41 |
| 32 | Are You a Quitter | 11 | 28 |
| 33 | Have You Ever Seen a Fox | 11 | 32 |
| 34 | The Zim-Zam Man | 11 | 25 |
| 35 | Bob and Nell | 13 | 42 |
| 36 | Swiss Fun Run | 13 | 35 |
| 37 | Fran Goes to the Prom | 15 | 50 |
| 38 | Planet Blip-Blop | 13 | 33 |
| 39 | Grand Slam Tennis | 13 | 34 |
| 40 | Lost in the Dump | 13 | 40 |
| 41 | The Robin | 13 | 36 |
| 42 | Snake and Ape | 13 | 31 |
| 43 | Rose's Birthday | 13 | 30 |
| 44 | The Nice Mice | 13 | 27 |
| 45 | No More Sad Tunes | 13 | 39 |
| 46 | Shelly's Shell Shop | 11 | 28 |
| 47 | Chip the Chimp | 13 | 26 |
| 48 | Click, Cluck, and Quack | 15 | 43 |
| 49 | The King Lost His Ring | 13 | 37 |
| 50 | Thad and Thelma | 13 | 27 |
| 51 | Whisker Bill | 11 | 19 |
| 52 | JoJo's Yo-Yo | 11 | 34 |
| 53 | The Bee and the Flea | 13 | 28 |
| 54 | Bread for Breakfast | 13 | 29 |
| 56 | Jake and Gail Go to Spain | 15 | 37 |
| 57 | Joan's Goats and Moe's Crows | 13 | 35 |
| 58 | The Kind Knight | 13 | 23 |
| 59 | Snoop the Crime Dog | 15 | 36 |
| 60 | A Good Day for Fishing | 15 | 29 |
| 62 | A Crow with Flaws | 11 | 23 |
| 63 | Toys for Boys | 13 | 31 |
| 64 | The Clown Who Lost Her Smile | 13 | 29 |
| 65 | The Roaring Storm | 13 | 33 |
| 66 | The Mare and the Hare | 11 | 20 |
| 67 | Barb's Sharp Car | 13 | 26 |
| 68 | Curls that Swirl | 13 | 23 |

（表内含第二轮已发布的 10 本，用于核对完整音频集；本轮实际新增 42 本。）

## 加工方式

1. **逐页读图转写**：42 本分 6 组由子代理逐页 ViewImage 读原图，按印刷行转写正文并给出逐行中译；封面、标题页、要素页与纯插图页不计正文。转写任务说明见 `library/derived/raz-decodable-rest-20261125/INSTRUCTIONS.md`。
2. **主审复核**：用逐页 OCR 与 Vosk 词级转写作双重校验——每页正文与该页 OCR 的词重合率必须 ≥ 0.5，整本词覆盖率另记；不达标即回查原页。
3. **发现并修正页码错位**：首轮按拼图数页时，把“纯插图占一页”的书（Bread、Bee and Flea、Jake and Gail、Joan's Goats、Snoop 等）整体错位一页，导致正文贴到错页、热区取错。已用“逐行对齐到逐页 OCR”的脚本重排页码并逐页复核（重合率多数为 1.0），另对 OCR 为空的 `Toys for Boys` 第 11 页手工核对原文并补热区。
4. **时间轴与音频**：沿用 Vosk 词级时间戳对齐文本，逐句（印刷行）裁切示范音频，最短补足 1 秒。
5. **门禁**：`hasCompletePublicLearningMapping`、`makeLegacyGlobalSource`、`makeLegacyGlobalProjection` 逐条生成复验；`ContentQueryService` 本地预读回 126/126（四批合计）。

## 发布与读回

| 批次 | 本数 | 媒体文件 | 哈希校验 | 备份 |
| --- | ---: | ---: | --- | --- |
| c1 | 8 | 474 | 474/474 | `pre-raz-dcb-rest-c1`（d61fafae…） |
| c2 | 8 | 457 | 457/457 | `pre-raz-dcb-rest-c2`（999c4e26…） |
| c3 | 8 | 426 | 426/426 | `pre-raz-dcb-rest-c3`（1f842564…） |
| c4 | 18 | 990 | 990/990 | `pre-raz-dcb-rest-c4`（2bbfdc8e…） |

每批均为：dry-run 预检（媒体哈希、ID 冲突、组织范围）→ 退出钩子短停服务单事务写入 → 立即恢复 → `/healthz` 返回 `ok`。

最终读回（生产库 + 真实仓储解码）：主记录 64/64、投影 128/128、审计 64/64；三组织教师目录均列出；详情 8—14 页；点读与跟读句段等量且全部带简体中译；矩形与时间边界 0 失败；线上阅读类已发布资源 246 条。

## 已知限制

- **音频仍为机器对齐**：以 Vosk 词级时间戳对齐已核对文本（整本覆盖率多在 85%—98%），未做人工试听；两处 ASR 未识别句按邻近边界插值。
- **子代理转写 + 主审抽检**：42 本正文由子代理逐页读图，主审用 OCR/词级对齐与可疑行回查控制质量，未做到 1,000+ 行全部人工二次通读；`Curls that Swirl` 的 `hurl` 曾在小图上误读为 `hurt`，经原页放大核对后改正，说明小字仍有误读风险。
- **句段按印刷行而非语义句**：`“I will get a big hit,”` 与 `said Wag the dog.` 会分成两段；点读/跟读按行工作，符合原书排版但不等于完整句。
- **年级映射仍为三年级 / 入门**，未做教研抽样。
- 标题页未单列；真机端到端未复测；本地资产索引未改写，仍为 `needs_review`。

## 剩余

- **Alphabet 27 本（有原音频）**：字母书，正文为 `A is for apple.` 一类短句，可套用现有阅读类型，尚未加工。
- **Sound Symbol 58—60 本（有原音频）**：每页是“音素+单词”（如 `spr / spring`），属拼读音素卡而非句子阅读；按现有类型发布会把单词卡当绘本，建议先定内容类型或明确“词卡阅读”例外。
- **Decodable Passages 20 本无原音频**：需配音或按无音频例外另行决定。

## 产物位置

- 派生包：`library/derived/raz-decodable-c1..c3-20261125/v1/`、`raz-decodable-42-20261125/v1/`、`raz-decodable-rest-20261125/`（子代理逐本 JSON 与任务说明）
- 载荷：`.runtime/raz-batch-c1..c4/docs.json`
- 回退：按批次删除对应 24/54 个资源 ID 与审计，并可用上述备份还原数据库。
