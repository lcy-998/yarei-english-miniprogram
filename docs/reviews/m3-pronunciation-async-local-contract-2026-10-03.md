# M3 跟读异步作业本地实现记录（2026-10-07 更新）

> 本文记录本地状态机与运行时接线。用户已说明由其后续进行评分质量测验；开发实现不代替该测验。**没有部署业务函数、集合、定时器或安全规则，也没有开放正式评分。** 固定 15/30 秒时限已由权威 0.62.0 口径取代；云端等待、费用与权限仍须受控施工核验。

**0.79.0 已确认的提交后延迟结果：**若录音文档的服务端冻结来源 tuple（组织/学员/任务/分配关系/任务项/句段/计划提交版本/源快照）与新建的正式提交版本完全匹配，且该版本包含同一任务项的阅读答案，worker 可在提交后完成该作业；recordingId 和录音哈希来自服务端原录音文档，不接受客户端补报。仅对 `processing`/系统 `failed` 记录允许重试，不可换录音或增加新有效尝试；试验分仅附于原提交版本，不改变正式成绩、学生任务关系或打卡。精确版本、身份、组织、授权、资源快照、录音哈希及答案引用任一不符仍须拒绝落结果。后端 `currentForScoring`、阅读任务正式提交版本/录音记录关联和学生 S-12 原录音重试入口已实现本地接线；S-09 通过入口导航到 S-12 回看；尚未实现云端端到端验收。改造要求见 `m3-pronunciation-delayed-result-decision-2026-10-06.md`。

## 已有代码的真实状态

- `PronunciationService.beginScore` 目前仍在学生请求内 `await inference.infer()`；`CloudBasePronunciationInference` 经 `@cloudbase/js-sdk.callFunction` 同步等 Python，并以本地 Promise 计时器拒绝结果。计时器不会可靠取消云端执行，最多一次自动重试还可能在第一次实际执行未终止时发出第二次。`processing` 类型和 S-05 轮询存在，但这条服务路径**从未持久写入 `processing`**。它不能作为 1 秒至 5 分钟云端评分闭环或 M3 人工验收通过证据。
- 新增 `src/pronunciation/job-state.ts` 纯状态转换及 `async-job-service.ts` 的本地持久作业服务：封存录音经可信受理后事务写 `processing`、回执及审计，同 `operationId` 幂等；分发状态 `pending/sent/finished`、worker 租约与最多两次模型调用受 CAS 限制；系统失败最多一次重试，低置信度 `unreliable` 无分数，可靠 `scored` 才占任务项五次有效次数。worker 开始前、模型返回后及结果事务内再查当前身份、授权版本和资源快照；撤权或漂移结果转失败。`DocumentPronunciationRepository.listPending` 与 `recoverPending` 可恢复受理事务提交后 Event 派发失败的 pending outbox。`job-wire.ts` 与内部 `pronunciation-worker/function-entry.ts` 实现独立 HMAC 事件契约和安全状态回执；`FreshPronunciationWorkerIdentity` 以当前数据库状态重新核查主体/角色/授权版本。
- 2026-10-06 已把异步 job capability 接入 `pronunciation-command` 默认 composition，并新增独立 `pronunciation-worker` Cloud Function entry 和只构建该 M3 worker 的 opt-in 构建目标。CloudBase Node deployment bootstrap 可通过专用运行时配置组装 SCF Event dispatcher、私有媒体签发、290 秒单次同步 Vosk 调用、身份复核与 worker；缺少配置时仍 fail closed。此代码路径尚未在目标 CloudBase 部署或联调。
- `DirectScfPronunciationTransport` 的本地候选以 TC3 签名直接调用 SCF：业务受理到 worker 用 10 秒 Event 接收回执；worker 到禁调 Python 用 `RequestResponse`、显式 290 秒 HTTP 中止、拒绝重定向、每方法仅一次发送。`LongPronunciationInference` 对私有 URL 域名与 `q-sign-time` 剩余有效期做保守校验，HMAC 签内部推理事件，单次只调用一次；系统重试只由持久作业计数。固定 TC3 签名向量、虚构 HTTP 500 单次发送、错误脱敏均在本地模拟通过。目标云函数/临时 URL 形态及冷/热等待还需 CloudBase 真实验证；此代码不代表默认 JS SDK 长等待已经在云端解决。
- 教师现有 `getTeacherEvidence` 只对正式提交版本、当前班级授权和匹配的 recordingId 签发受控试听；返回仍是 `experimental:true`。本地新增独立家长 `getParentEvidence`，逐次核对当前 `child.read` 绑定、组织、学生、任务项/提交版本及正式答案中明确引用的 recordingId；响应使用显式白名单，固定 `experimental:true`、`score:null`、`playback:null`、`officialScoreAvailable:false`，只保留状态/版本/媒体过期信息，不返回 scoreId、recordingId、内部版本号或私有路径，并记审计。`listParentEvidence` 再提供一次绑定校验、一次正式提交读取的批量入口，按**提交答案实际引用**的录音 ID 形成句段安全状态行；缺失引用仅返回聚合数量，不让家长页面猜测句段或逐句发 N 次请求。跨家长或撤权拒绝；家长页面尚未云端联调，试验分继续不计正式任务成绩、报告或打卡。
- S-12 本人列表的可信查询本地新增 `pronunciation-query.listMyWorks({cursor,limit})`，只从当前学生组织/本人录音分页返回状态、试验分、来源、标题/片段、时间及 `mediaExpired`，不返回 `cloud://` 或临时地址。`mediaExpired:null` 表示没有可验证的正式提交锚点，包括自主阅读，**不等于禁止本人试听**，也不能暗示永久保留。独立 `getMyPlayback({recordingId})` 每次核对本人归属、正式提交到期或物理删除状态，只对仍在存储且未到期的本人录音签 60 秒短期 URL 并记审计；到期时返回 `playback:null`。自主阅读跟读原始录音的 180 天起算点尚待用户确认，当前清理器只处理正式课堂提交。列表/试听已过本地权限、179/180天和私有路径投影测试，云端与页面仍未验收。

## 已确认的异步事务处理顺序

1. `PronunciationAsyncJobService.accept` 在可信学生身份、当前班级/资源授权、可提交时段、发布快照、封存文件哈希与大小、提交版本和五次有效上限逐次核验后，单事务 CAS 写入 `processing`、作业 ID、`scoreOperationId`、版本、待派发状态、操作回执和审计，然后**立即**返回 `scoreId=recordingId` 与 `expectedVersion`。不在该请求中等模型。相同操作 ID 只返回同一作业；失败后的人工重试须新操作 ID 和最新版本，旧操作 ID 不会重新计费或重复受理。命令入口已经允许注入此服务；当前 CloudBase 默认入口未注入，旧同步推理端口被显式置空，故未开放业务评分。
2. 录音文档的待派发状态是持久 outbox。受限 Node worker 只扫描/领取该状态，按 CAS 租约防重，并使用服务端签名与新的明确等待上限调用禁调 Python；页面/学生请求无法直接派发或完成。若派发前进程崩溃，受控扫描可找回 `pending`；若已派发但回执不确定，不盲发第二次，先查作业状态/平台请求 ID。系统失败最多重新执行一次，两个尝试共享同一作业 ID；没有权限或版本匹配的结果永不落分。
3. 完成端在事务内再次读取录音、当前学员状态、任务/阅读授权、发布快照、源提交版本、媒体哈希、模型/算法版本、作业操作 ID、租约和该任务项有效次数；CAS 只允许一次 `processing→scored|unreliable|failed`。任务模式允许计划提交版本在作业受理后成为当前正式提交版本；必须核对该不可变提交含同一任务项的阅读答案，并复核服务端录音文档的组织/学员/任务/分配关系/任务项/句段/提交版本/源快照、当前主体授权和音频哈希。`scored` 保存原始试验维度和有效尝试编号，`unreliable`/系统失败不占次数；同一作业重试只处理系统失败且不增加次数。结果只附于原提交版本，不改变正式成绩/任务关系/打卡；重复或迟到回执去重，撤权、轮次变化到另一版本或录音未被提交引用均拒绝。
4. S-05 仅轮询/手动刷新本人只读 `getScore`；`processing` 无分数且不计任务/打卡，离页后通过 `listAttempts` 找回。云端单次/最终等待上限未冻结前，页面的 35 秒本地自动轮询截止只表示转为手动刷新，不能标记服务失败。学生保留本机及封存录音，网络错误用同一操作 ID 查询恢复。教师只读从正式提交版本拿 `experimental` 投影和受控试听；家长入口须独立逐次校验绑定关系且不得展示试验分为正式成绩。

## 运行与安全门槛

- 现有 CloudBase JS SDK 同步 `callFunction` 不提供本方案所需的可证明长等待/真正异步派发。worker 需要审定的 SCF Event 派发、受控同步 `Invoke(RequestResponse)` 或等价可取消且有回执的调用适配器，明确 HTTP 超时、平台异步重试、队列滞留、节点函数超时及 GB·秒预算。不能用“Node 不 `await` Promise”冒称持久后台作业，也不能单靠本地计时器取消已发出的云端推理。第三轮近五分钟性能和费用通过后，另形成一份含集合/索引、业务函数、HMAC 密钥、客户端禁调规则、回退与虚构端到端探针的 M3 云端审阅包，获新授权才部署。
- 评分结果/作业字段必须按组织、学员、任务/句段、提交版本和源版本隔离；现有 `pronunciation_recordings`、`pronunciation_operations` 两个计划集合仍未云端建立；读取提交关联时使用录音来源的 assignment/item/submissionVersion tuple，不依赖阅读作答答案包含 recordingId。后续独立业务审阅包须逐项列出 `beginRecording/sealRecording/beginScore`、本人 `getScore/listAttempts/listMyWorks/getMyPlayback`、教师 `getTeacherEvidence` 和家长 `getParentEvidence/listParentEvidence` 的 action、关系授权、必要索引、代码读回、匿名/跨组织/撤权拒绝与精确回退；家长批量接口只在服务器读取提交答案引用，不把录音 ID、URL 或试验分透出。原 38 只业务函数、六项旧业务密钥、M1/M2 数据不因本方案修改。
- 当前状态为**本地异步作业和学生回看/同录音重试已接线，云端与人工页面闭环未验收**。仍缺目标 CloudBase 的 Event/同步 Invoke 等待验证、待派发扫描/租约恢复定时器、集合/索引/安全规则与函数部署、失败/超时回执及实际额度证据。最新施工范围见 `docs/reviews/m3-pronunciation-business-closure-review-2026-10-06.md`。2026-10-07 实际运行后端及小程序 `npm run typecheck`；没有运行业务测试或微信页面验收。用户将自行负责后续评分质量测验，开发记录不宣称质量通过。

## M3-RET 跟读原始录音

`MediaRetentionService` 本地增加 `pronunciation` 类型，`TaskPronunciationSubmissionLookup` 以正式阅读提交的任务项及其冻结提交版本，结合录音记录的组织/学员/任务/分配/任务项/句段来源元组确定 180 天起点；未正式提交的录音不因此清理。到期先停止教师试听地址签发，再由受控维护作业只按服务器推导的精确 `pronunciation/private/.../<sha>.mp3` 路径删除，重复执行幂等，记录审计，只标记 `mediaDeletedAt`，保留原评分、提交和点评历史。179/180/181 天、错误路径、撤去正式阅读项后的 stale 及重复执行已有注入时钟虚构测试。尚未接维护函数或调用云存储实际删除；S-12 用户主动删除未提交作品草稿的七天恢复是另一条规则。
