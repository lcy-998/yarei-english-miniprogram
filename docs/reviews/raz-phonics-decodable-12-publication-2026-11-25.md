# RAZ Phonics 解码读本 12 本加工与发布（2026-11-25）

## 结论

`ZP0001-RAZ Phonics/RAZ Decodable Books` 中 12 本优先候选已完成逐页正文核对、逐句时间轴、逐句简体中文译文、逐句示范音频裁切，并按既有“绘本阅读”类型发布到全教师可布置目录：12 条主记录、24 条跨组织投影、12 条审计，`published` / `visibility=organization` / `teacherCatalogOnly=true` / `catalogScope=all_teachers` / `allowedClassIds=[]`。云端读回 36/36（12 本 × 3 组织）通过。

本轮不改变产品类型、不新增自然拼读入口；不使用 `page_only` 例外，12 本均提供章节朗读 + 逐句点读 + 逐句跟读示范。

## 批次范围

| 顺序 | 资源 ID | 书名 | 页数 | 句段 | 音频时长 |
| ---: | --- | --- | ---: | ---: | ---: |
| 1 | `book-35d9e84580ac` | A Tap and a Pat | 9 | 12 | 43.8s |
| 2 | `book-17ca777e0e9f` | Dan the Tan Man | 9 | 19 | 93.7s |
| 3 | `book-45585c427e28` | I Can Hop | 9 | 13 | 44.4s |
| 4 | `book-15da391569b4` | Did It Fit | 9 | 15 | 47.1s |
| 5 | `book-4e18c80257c4` | Big Bad Bat | 9 | 12 | 80.2s |
| 6 | `book-0598033b0e57` | The Pin with a Tin Fin | 9 | 18 | 68.5s |
| 7 | `book-b615d87de87a` | The Fat Cat | 9 | 15 | 69.6s |
| 8 | `book-0438b35d8c2a` | Red Hen and Rod Rat | 9 | 19 | 108.3s |
| 9 | `book-13c324942eec` | The Mutt and the Bug | 9 | 14 | 65.4s |
| 10 | `book-9f65ccaf338c` | My Pug Has Fun | 9 | 15 | 66.6s |
| 11 | `book-5bdeeccd24f0` | Lil, Sal, and Bill | 9 | 15 | 72.7s |
| 12 | `book-8a770251b13f` | Kit and Kim Are Kin | 9 | 16 | 72.0s |

合计 183 个句段、12 段原书 MP3、411 个媒体文件（108 页图 + 108 缩略图 + 12 音频 + 183 裁切片段，约 36 MiB）。

## 加工与审核证据

1. **来源与权利**：PDF/MP3 哈希与该批 2026-10-27 缺口矩阵及 `bbc-raz-owner-rights-link-2026-10-27.json` 逐文件一致（24/24）。使用依据为项目负责人对“RAZ 文件在小程序展示、复制、改编并向授权学生分发”的确认记录，不宣称已独立取得 Learning A-Z 出版方许可；该口径写入每条记录的 `payload.copyrightEvidence`。
2. **逐页正文**：12 本 × 9 页共 108 页逐页查看原页图，人工读出学生实际朗读的正文（封面、标题页、版权/要素页不计入句段），形成 `review/<book>.json` 的 `text`。标题页（第 2 页）与要素页（第 9 页）不进入正文句段：前者与封面重复且为作者/插画师署名，后者为教学要素表。
3. **逐句时间轴**：用 2026-10-15 Vosk 词级时间戳与已核对文本做序列对齐，句首减 120ms、句尾加 160ms 并裁到音频总长；全部句段满足 `0 ≤ startMs < endMs ≤ durationMs` 且相邻不重叠。文本词覆盖率 85.6%—100%（中位约 92.6%），未覆盖部分为 ASR 误识（如 `mat→matt`、`Nan→man`）。
4. **逐句中文译文**：183 句全部由 Codex 撰写并复核为简体中文，写入 `pronunciation.segments[].translationText`（均 < 500 字符），满足 2026-11-24 起的中英对照要求。
5. **逐句示范音频**：按句段时间在原始 MP3 的帧边界裁切，最短补足 1 秒；183 个片段均可被本机 MP3 帧解析器完整读回（首帧 `0xFFFB`，时长与记录一致）。
6. **页面热区**：用同一页 OCR 词框按句合并出归一化 `rect`，全部落在 `[0,1]` 内且宽高为正；跨行句段取两行并集。
7. **记录生成与门禁**：用仓库自有 `hasCompletePublicLearningMapping`、`makeLegacyGlobalSource`、`makeLegacyGlobalProjection` 生成并复验 36 条记录；再用 `ContentQueryService` 对内存副本做目录、详情、点读映射、跟读句段四项读回，36/36 通过后才上传。

## 发布与云端读回

- 媒体：单包上传后解包到 `/var/lib/yarei-v0128/storage/raz-phonics-20261125/`，`sha256sum -c` 411/411 一致，属主 `yarei:yarei`、文件 600、目录 700。
- 备份：`/var/lib/yarei-v0128/backups/manual/business.sqlite.pre-raz-dcb12-20261125`（SHA-256 前缀 `df39f5658b8f1493`），含 WAL 副本。
- 写入：dry-run 预检（媒体哈希、ID 冲突、组织范围）无问题后，退出钩子短停 `yarei` 单事务写入 48 份文档（36 资源 + 12 审计）并立即恢复；`/healthz` 返回 `ok`。
- 读回（生产库 + 真实仓储解码）：主记录 12/12 `globalCatalogSource`，12/12 `teacherCatalogOnly`，12/12 `published`，12/12 `visibility=organization`；投影 24/24；审计 12/12。三组织教师目录均列出对应记录，详情 8 页、点读句段 12—19 条、跟读句段与点读等量且全部带中文；矩形与时间边界校验 0 失败。

## 已知限制

- **未做人工/代理实际听辨**：本轮音频内容的依据是 Vosk 词级转写与已核对文本的对齐（覆盖率见上），属机器证据，不能宣称“逐句试听通过”。两处 ASR 未识别句（`I Can Hop` 的 “Hop, hop, hop.” 与 “No.”）由相邻边界插值，已核对转写中确有 `hup hup hup` 与 `know` 对应，但仍属推断。
- **年级映射为产品判断**：12 本按“入门解码读本”映射为三年级、难度“入门”，与现有自然拼读课程的三—六年级口径一致；未做教研抽样确认。
- **标题页未进入章节**：第 2 页（书名+作者+插画师）未作为独立页面提供；封面已含书名，正文从第 3 页起。
- **未重做真机端到端**：教师布置→学生点读/跟读→教师查看沿用既有阅读链路基线，本轮未在真机复测；跟读评分未针对新片段重新验证。
- 本地资产索引仍把这 12 本记为 `needs_review`；本轮未改写索引状态，避免用机器状态冒充审核，目录数量以云端读回为准。

## 产物位置

- 派生包：`G:\英语资产\library\derived\raz-decodable-12-20261125\v1\`（`review/*.json`、`media/clips/`、`media/files.json`、`media/audio.json`）
- 发布载荷：`D:\app\.runtime\raz-batch\docs.json`（36 资源 + 12 审计）
- 脚本：`D:\app\.workbuddy\raz_build.py`、`raz_media.py`、`raz_docs.mjs`、`raz_readback.mjs`、`publish-raz.mjs`、`raz-readback-prod.mjs`
- 回退：删除 36 个资源 ID 与 12 个 `audit_raz_dcb*_20261125` 审计，媒体目录可整体移除；数据库可用上述备份还原。
