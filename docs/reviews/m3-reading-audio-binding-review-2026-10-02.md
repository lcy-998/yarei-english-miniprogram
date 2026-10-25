# M3 阅读音频与页图点读最小样本审阅包（2026-10-02）

> 当前状态：**仅本地候选，未审核、未绑定、未部署。** 本包只处理非生产虚构三年级 2 班既有测试绘本 `res_m3_real_sbc0008_reading_20260930`，供 S-04 音频和页图点读后续联调。没有改动云数据库、存储或函数；现有 M2 页图阅读继续可用。本包不使听力、视频或任务配音课堂发布放行。

## 已固定的本地证据

- 原始样本清单为 `workspace/m3-real-samples/2026-09-30/manifest.json`，SHA-256 `6567305a063ed06769997f0c7b87c348ce4f1b1f7da1bd538f331bb7655184b2`。候选字幕 SHA-256 `aa448ffb3492e414beb859a402390db7209b3303711174ae3fa4dbf9d98a9174`。
- `build-reading-audio-candidate.mjs` 从 9 页元数据、候选 VTT、整本与逐页 MP3 构造 `reading-audio-candidate.json`。实际运行核对 **10/10 段本地音频**的字节数及 SHA-256、8 个正文页的文字一致、0—1 归一化热区、连续片段边界与 24,360 ms 总时长。输出含 8 条 `pageId`、`rect`、`startMs/endMs`，从第 2 页 3,264 ms 到第 9 页 24,360 ms；文件明确为 `pending_review`、`releaseAllowed:false`。候选内容规范 JSON 摘要 `e08c8c7d2082c97a14f78b7eef70a1ec2ac31296d5a20566e928981547f654fb`。
- [Storybooks Canada 原作品页](https://www.storybookscanada.ca/stories/en/0008/)列出作者 Nina Orange、插画 Wiehan de Jager、朗读 Darshan Soni，并标注 CC BY 3.0。这里记录来源与署名，**不代替项目负责人对具体图片、音轨、改编形式和展示署名的最终版权判断**。既有非生产数据库记录仍是 `copyrightStatus=demo`；不得仅因网页标注许可而自动改为 `verified`。

## 服务契约与审核门槛

- 已本地实现 `content-query.getReadingAudioMap({resourceId,chapterId})`：先按当前学生/教师、组织和班级读取已发布阅读资源；只有 `copyrightStatus=verified`、`readingAudio.reviewStatus=approved`、审核人与时间齐全且 `sourceVersion` 与资源版本一致时，返回本章音频 60 秒 HTTPS 地址、逐页文本热区与片段毫秒范围。未审核或旧版资源返回空音频，坏坐标/片段拒绝，响应不含 `cloud://` 文件 ID。小程序 `getReadingAudioMap` 已按当前业务会话接线；**云端现有 `content-query` 未部署此 action**。
- 候选包的 `cloudPath` 仅供审阅。正式绑定前须由受控操作从云端现有私有文件清单解析精确 fileID，核对 10 个音频哈希与资源当前 CAS 版本，逐一人工试听第 2—9 页与整本音轨并复核 8 个词句热区。审核记录应指向候选摘要、来源许可决定、人工复核人与时间；不能从候选 `pending_review` 静默升级为 `approved`。
- 本自主阅读查询只使用当前已审核资源版本。课堂任务模式必须从**发布快照**读取冻结的章节音频、热区、片段和媒体版本，不能借当前资源绕过历史任务快照；该任务模式接口与发布门槛尚未完成，所以学生任务页不得提前开放点读。

## 待授权的非生产最小操作（尚不执行）

1. 只读核对唯一非生产环境、资源当前版本、班级授权、10 个私有音频 fileID/哈希、`content-query` 当前代码版本与完整安全规则，以及本周期剩余额度。任何配置值、密钥、临时 URL 不进入文档或工具输出。
2. 在版权与人工媒体审核决定明确后，按精确资源 ID 与 CAS 版本只更新该条测试绘本的版本化 `payload.readingAudio` 和审核记录；如需把 `copyrightStatus` 从 `demo` 改为 `verified`，须项目负责人明确确认该版权决定。既有页图、进度、任务与其他资源不改写。
3. 在 M3 独立审阅包和用户一次明确授权后，仅部署新增只读 action 所需的 `content-query` 精确函数版本，保留发布前不可变回退版本；不重发其余既有函数，不轮换或注入已要求维持的六项业务密钥。当前密钥风险决定可能使本步骤仍不能执行，须协调任务先判定。
4. 用当前虚构班级学生执行 S-03→S-04 逐页试听、点热区只播对应片段、倍速/磨耳朵与地址到期续签；跨班、撤权、无审核、坏映射和伪造 fileID 均拒绝。教师 T-08 的任务只读媒体、真机与弱网另列专项，不由此样本自动通过。

## 回退与验收结论

任一版权、人工对位、哈希、授权、费用或安全规则核对失败时，保持 `pending_review` 和现有页图阅读状态。若未来受控部署回归失败，恢复该资源原 CAS 内容与 `content-query` 不可变旧版本；保留审核和操作审计，不删除已发布任务、学生进度或原媒体。本包目前只通过本地静态候选校验，S-04 音频与点读**不能记为功能验收通过**。
