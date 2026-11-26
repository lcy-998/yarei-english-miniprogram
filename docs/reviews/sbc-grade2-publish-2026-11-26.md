# 二年级阅读补内容 · 发布验证报告（2026-11-26）

> 背景：11-25 的缺口盘点确认「二年级听力 / 阅读 / 词汇三项全零」是全平台最刺眼的空白。
> 11-26 上午执行了 Storybooks Canada 二年级分级阅读首批发布，写入命令后主会话因频率限制中断，
> 未取得 `WRITE_COMMITTED` 回执与最终读回。**本报告为事后只读核验，不重跑发布。**

## 1. 结论（一句话）

**发布已完整成功落库、服务已正常恢复、端到端读回 12/12 全通过，0 failures。无需补写、无需回滚。**

| 核验项 | 结果 |
| --- | --- |
| 发布前备份 | `/var/lib/yarei-v0128/backups/business-before-sbc-grade2-20261126.sqlite`（23.7 MB，10:25）✅ |
| 服务进程 | `yarei.service` **active**，10:25:36 CST 重启，0.128.0 runtime ✅ |
| 健康检查 | 回环 `127.0.0.1:3200/healthz` **200**；公网 `https://video.aimanhua.xin/healthz` **200**（服务器端探测）✅ |
| 资源总量 | `learning_resources` **1,773 → 1,785**（+12）✅ |
| 已发布总数 | **1,555 → 1,567**（+12）✅ |
| 媒体文件 | 服务器 `storage/sbc-grade2-20261126/` 共 **91** 个 ✅ |
| 端到端读回 | **12/12 通过，0 failures** ✅ |

> 注：本机直接 `curl https://video.aimanhua.xin/healthz` 返回 `000` 是本地网络/探测方式问题，
> 从服务器侧与回环口实测均为 200，服务无故障。

## 2. 本次上线内容（二年级阅读 0 → 4 本）

素材取自 **Storybooks Canada / African Storybook，CC BY 4.0**，可合法上线。
之所以不用原计划的海尼曼 GK/G1：其页图带第三方微信公众号水印（「王木木de宝藏地…+v：xiaxia1198」），
且线上已发布 6 本 GK 有同样风险，已整体停用该来源。

| 书名 | 主题 | 页数 | 点读/跟读句段 | 整本音频时长 | 中文译文 |
| --- | --- | ---: | ---: | ---: | ---: |
| Feelings | 感受 · English Level 1 | 5 | 5 | 29.6 s | 5/5 |
| Cooking | 做饭 | 8 | 8 | 33.2 s | 8/8 |
| Hair | 头发 | 8 | 8 | 36.9 s | 8/8 |
| Where Is My Cat? | 我的猫在哪 | 8 | 8 | 32.9 s | 8/8 |
| **合计** | | **29** | **29** | — | **29/29** |

媒体构成（91 个）：4 个整本音频 `audio/full.mp3` + 29 页图 `pages/pNNNN.jpg` + 29 缩略图 + 29 逐句跟读片段 `clip`。
所有文件按 `cloud://…/sbc-grade2-20261126/…` 引用，与本地 `files.json` 的 key/sha256 一一对应。

## 3. 记录构成与归类

| 类别 | 数量 | ID 形态 | 说明 |
| --- | ---: | --- | --- |
| 主记录（源） | 4 | `res_sbc_g2_{slug}_20261126` | `type=reading`、`grade=二年级`、`status=published`、`globalCatalogSource=1`、`category=picture_book`、`difficulty=入门` |
| 跨校/跨组织投影 | 8 | `global_asset_{sha256}` | `org_yarei` / `org_isolation_secondary` 各 4 |
| 审计日志 | 4 | `audit_sbc_g2_{slug}_20261126`（`operation_logs`） | `content.publishedByCodexReview`，含逐页核对依据与权利依据 |
| learning_resources 净增 | **12** | | |

归类沿用现有 8 类 `type` + `grade/textbook/unit/knowledgePoint/difficulty`，**未新增枚举、未改 grade 定义**
（二年级在原 1–9 枚举内，无需扩字段），规避了甲方全套内容接入时才会遇到的高中年级阻塞。

## 4. 端到端读回（生产库真实查询服务，只读）

用 `ContentQueryService` + `createOrgContentDocumentRepository` 对 **3 个组织 × 4 本 = 12 组合**逐一验证：

- `listReadingResources` → 目录可见（`org_qihang_demo` 走全局源主记录，另两组织走投影）；
- `getReadingResource` → 章节页数 5/8/8/8 正确；
- `getReadingAudioMap` → 句段数 = 页数，热区矩形全部落在 [0,1]，时间区间合法且在 `durationMs` 内；
- `getReadingPronunciationSegments` → 每段均带 `translationText`，中文译文 29/29 齐全；
- **failures = []**。

## 5. 权利与质量边界

- 权利依据：CC BY 4.0（Storybooks Canada / African Storybook），审计日志已记录。
- 加工：逐页视觉核对页图与正文 → 页音频按官方音频包逐页对应 → 逐页中文译审 → 媒体哈希读回。
- **未人工试听**整本音频（沿用 RAZ 批次的 ASR 对齐口径），真机小程序未复测（开发者工具服务端口未开）。
- `audioMode` 字段未显式标注（与库内其他 111 条教材/绘本一致，实际走 `payload.readingAudio` + `payload.pronunciation`），读回可用。

## 6. 仍未补上的缺口（诚实清单）

本次只补了「二年级阅读」这一格，其余空白不变：

| 缺口 | 状态 |
| --- | --- |
| 二年级 **听力** | 仍 0 |
| 二年级 **词汇** | 仍 0 |
| 七、八年级听力 | 仍 0 |
| 一、二、九年级词汇 | 仍 0 |
| 初中泛读层 | 仍无 |
| 写作 / 语法专项 / 自然拼读独立入口 | 仍 0 |
| 250 条视频 payload 无题目字段（与「188 集 940 题」记录不符） | 待核 |

继续补这些需要新一轮素材加工（听力切分、词汇卡、题包），且部分涉及素材权利复核，未擅自启动。

## 7. 排障备忘

1. SSH 必须用 `-i ~/.ssh/yarei_aliyun_windows -o IdentitiesOnly=yes`，默认密钥会 `Permission denied (publickey)`。
2. 统计 SBC 记录**不能**用 `id LIKE '%sbc%'`：会命中一批历史验收件
   （`res_launch_sbc00*`、`res_m3_sbc0008_*`、`res_prod_sbc0008*`、`book-sbc-en-*`），产生 156 条假阳性。
   应按 `updatedAt='2026-11-26T02:24:50.500Z'` 或 `body LIKE '%sbc-grade2%'` 精确筛。
3. `publish-raz.mjs` 的 `WRITE_COMMITTED` 计数原硬编码 `id LIKE 'res_raz_dcb%'`，
   对非 RAZ 批次恒为 0，会误导成「未提交」；已改为按 `docs.resources` 实际 id 统计（仅改统计口径，不影响写入）。
4. 服务器端 `/tmp` 会被清理，读回依赖 `raz-readback/entry.cjs` 需重新打包上传，不能直接复用。
