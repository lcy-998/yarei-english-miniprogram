# RAZ Phonics 解码读本第二批 10 本加工与发布（2026-11-25）

## 结论

按用户“继续下一批”的确认，在第一批 12 本之后又完成 10 本解码读本的加工与发布：10 条主记录、20 条跨组织投影、10 条审计，`published` / `visibility=organization` / `teacherCatalogOnly=true` / `catalogScope=all_teachers` / `allowedClassIds=[]`。云端读回 30/30（10 本 × 3 组织）通过。RAZ 解码读本累计已发布 22 本。

## 批次范围

| 资源 ID | 书名 | 页数 | 句段 | 音频 |
| --- | --- | ---: | ---: | ---: |
| `book-22b54337b945` | Nan and Pap | 9 | 6 | 21.7s |
| `book-5b3e356188a8` | A Nap and a Map | 9 | 8 | 30.6s |
| `book-921f317e8f44` | Sam and the Sap | 9 | 6 | 34.6s |
| `book-5c97de5c80a3` | The Tot and the Pot | 9 | 9 | 36.2s |
| `book-1fb765300cd8` | Don and Dots | 11 | 15 | 74.0s |
| `book-448b07c5410a` | Get the Pets | 9 | 12 | 48.2s |
| `book-95830e405def` | Hot at the Dam | 11 | 20 | 75.6s |
| `book-5c3924a67739` | A Fat Hat | 11 | 16 | 66.0s |
| `book-3d772b68964e` | Get the Gag | 11 | 18 | 74.1s |
| `book-2ab468e38e11` | Ten Pets | 11 | 17 | 74.4s |

合计 127 个句段、337 个媒体文件（100 页图 + 100 缩略图 + 10 音频 + 127 裁切片段，约 30 MiB）。

## 加工与审核证据

1. **来源与权利**：与 2026-10-27 缺口矩阵及权利关联文件哈希一致；权利口径同第一批（项目负责人确认的展示/复制/改编/向授权学生分发记录，不宣称出版方独立许可），逐条写入 `payload.copyrightEvidence`。
2. **逐页正文**：100 页逐页查看原页图核对，封面/标题页/要素页不计句段；每本书的逐页文本与译文登记在 `source/batch.json`，处理结果写入 `review/<book>.json`。
3. **逐句时间轴**：Vosk 词级时间戳与已核对文本序列对齐，句首 −120ms、句尾 +160ms 并裁到音频总长；127/127 句均有实际词匹配（覆盖率 84.9%—100%，无整句插值）。
4. **逐句中译**：127 句全部经 Codex 简体中文译审，逐句写入 `translationText`。
5. **逐句示范音频**：按 MP3 帧边界裁切，最短补足 1 秒；127 个片段均可完整解析。
6. **页面热区**：OCR 词框按句合并，全部落在 `[0,1]`、宽高为正。
7. **门禁**：`hasCompletePublicLearningMapping`、`makeLegacyGlobalSource`、`makeLegacyGlobalProjection` 逐条生成并复验；`ContentQueryService` 本地预读回 30/30。

## 发布与云端读回

- 媒体：`raz-phonics-20261125/` 下新增 10 个书目录，`sha256sum -c` **337/337 一致**，属主 `yarei:yarei`、文件 600、目录 700。
- 备份：`/var/lib/yarei-v0128/backups/manual/business.sqlite.pre-raz-dcb10b-20261125`（SHA-256 前缀 `b329b243ef290aec`）。
- 写入：dry-run 预检（媒体 337、ID 冲突、组织范围）无问题后，短停服务单事务写入 40 份文档（30 资源 + 10 审计）并恢复；`/healthz` 返回 `ok`。
- 读回：主记录 10/10、投影 20/20、审计 10/10；三组织目录均列出，详情 8—10 页，点读与跟读句段等量且全部带中文，矩形与时间边界 0 失败。线上 RAZ 解码读本 22 个标题 / 66 条记录，无重复。

## 已知限制

- 同第一批：音频为 Vosk 词级对齐的机器证据，未做人工试听；年级按入门解码读本映射为三年级；标题页未单列；真机端到端未复测；本地资产索引未改写。
- 第 6 页存在原书时态混用（`put`/`puts`），按原页保留，未改写教材文本。
- `Nan and Pap` 仅 6 句、时长 21.7 秒，属于极简入门读本；课时使用建议教师搭配其他读本。

## 产物位置

- 派生包：`G:\英语资产\library\derived\raz-decodable-10-20261125\v1\`（`source/batch.json`、`review/`、`media/`、`checks/contact-sheets/`）
- 发布载荷：`D:\app\.runtime\raz-batch2\docs.json`
- 脚本：`D:\app\.workbuddy\raz_pipeline.py`、`raz_docs2.mjs`、`raz_readback2.mjs`、`publish-raz.mjs`、`raz-readback-prod.mjs`
- 回退：删除 30 个资源 ID 与 10 个 `audit_raz_dcb*_20261125` 审计，媒体目录可整体移除；数据库可用上述备份还原。
