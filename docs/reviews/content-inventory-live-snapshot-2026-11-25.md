# 生产资源库实时快照（2026-11-25）

## 取数范围与证据

本快照是在已授权的受管只读 SSH 通道下查询阿里云生产服务器 `/var/lib/yarei-v0128/business.sqlite` 的 `learning_resources` 集合；查询时间 `2026-11-25 11:30:36+08:00`。服务 `yarei` 为 `active`，`/healthz` 返回 `ok`、版本 `0.128.0`；SQLite `PRAGMA integrity_check` 返回 `ok`。数据库文件当时 14,925,824 字节；挂载卷 40 GiB、可用 9.9 GiB。无 systemd pending job，`who -u` 未列出交互登录；不代表无 HTTP 业务请求，正式写入仍应按既有流程先备份并短停服务。

本次仅查询教学资源状态、类型、组织与若干内容 ID；没有读取用户个人资料、没有修改生产库、没有上传媒体或修改资产索引。生产快照精确到查询时点，本地原始资产盘点仍为 2026-11-22 的 80,178 文件 / 34.61 GiB，尚未重新全盘扫描。

## 资源状态总数

| 状态 | 条数 |
| --- | ---: |
| `published` | **1,039** |
| `offline` | 210 |
| `draft` | 8 |
| 合计 | **1,257** |

已发布类型分布：

| 类型 | 已发布条数 |
| --- | ---: |
| video | 500 |
| exercise | 346 |
| reading | 90 |
| vocabulary | 57 |
| listening | 29 |
| dubbing | 14 |
| recording | 2 |
| work | 1 |

`published` 中按 ID 前缀 `public_media_*` / `public_question_*` 识别的投影为 508 条；其余 531 条为源记录或本组织记录。当前生产数据有 3 个 active 组织：`org_qihang_demo`、`org_isolation_secondary`、`org_yarei`。全教师投影目标按具体资源类型沿用当前生产发布模式；教师目录新增内容不得设置个人、班级白名单。

各状态/类型完整计数：

| 类型 | Published | Offline | Draft |
| --- | ---: | ---: | ---: |
| dubbing | 14 | 2 | 0 |
| exercise | 346 | 146 | 6 |
| listening | 29 | 26 | 0 |
| reading | 90 | 9 | 2 |
| recording | 2 | 3 | 0 |
| video | 500 | 18 | 0 |
| vocabulary | 57 | 5 | 0 |
| work | 1 | 1 | 0 |

## 与 11 月 24 日盘点的已知变化

以下为发布报告与实时库当前记录的交叉核对，不把历史发布量误作新增：

- 中国历史 7 季共 188 集已发布（188 主记录 + 188 投影）；发布报告明确还留 1 集第 7 季未纳入发行范围，并记有 S1 仅保留 1 份转写样本、S3 少 1 份转写文件等限制。详见 `G:\英语资产\library\derived\china-history-english-20261124\全系列完成报告-20261125.txt`。
- RAZ Decodable Books 首批 12 本已发布（12 主记录、24 投影、12 审计）。逐页正文、183 个双语句段和 411 个媒体文件已生成；发布报告明示未做人工听辨，时间轴由 Vosk 对齐，需作为已知内容验证限制追踪。详见 `docs/reviews/raz-phonics-decodable-12-publication-2026-11-25.md`。
- CIP 六年级 v4 的 20 道补充题已经发布；其视频本身不是本次新增视频。此前发布报告指出每段视频仅 1 道补充题、教师必须同时选视频，不将其冒称完整视频题组。
- BBC 6 Minute English《What makes a great library?》已有新听力主记录 `res_bbc_6me_240314_library_listening_v1_20261125`，并有 `org_isolation_secondary`、`org_yarei` 两个 `public_media` 投影；BBC《Becoming a musician》也已有源记录及投影。前者本次检查时来自 11:13 发布回执；内容复核明确 `directListeningThisRun=false`，其句段依据为英文字幕与同名 MP4 音频相关性，不宣称人工试听。
- 人教九年级上册 `book-pep-9a-2022` 已按获准 `page_only` 例外发布；141 页图 + 141 缩略图哈希读回通过，ISBN/具体印次仍未核实，音频、点读、跟读关闭。

## 当前发布队列状态

- CIP Dragon Boat 及另外 4 个六年级 v1 视频题组已形成本地五题候选，共 25 题；尚未注册或发布。内容包与题面已复核，已发布视频版本和用户权利依据已绑定。其生产 ID/重复、投影、备份与写入前只读预检正在执行；仅公开 `/healthz` 不足以通过这些门槛。
- 中国历史 S3/S4 原始 candidate v3 与 payload 已经有生产发布报告覆盖，禁止按旧交接信息重复发布；如确需修补缺失证据或发现题目错误，应另建新内容版本并对照当前线上版本。
- PEP 718 条官方音频仍须逐单元核对；3A Unit 1 试点报告指出版次/ISBN、逐页对位、完整音轨核验和新扫描/解码播放缺项。
- BBC、Heinemann、Kumon、剩余 RAZ 及其他未处理项目仍按项目 6.9 / G 盘 `PRODUCTION-CONTENT-GATE.md` 分批审核。没有因清单 `publish_ready`、文件存在、哈希匹配或全库版权声明自动放行。

本文件为 11 月 24 日本地盘点的线上增补，不覆盖原始盘点、历史发布报告或产品需求。后续对生产库写入必须生成新备份、预检、单写入方原子事务并独立读回；公开健康检查不能替代实时 DB 与回退核验。
