# M3 Vosk 云端故障分层诊断重试审阅包（待授权，2026-10-03）

> **当前不执行云端更新或调用。** 前一轮的授权范围和实际结果见 `m3-vosk-cloud-only-benchmark-review-2026-10-02.md`、`m3-vosk-cloud-only-benchmark-execution-2026-10-02.md`。本包只修复一只已新增的内部函数并区分模型加载与私有媒体下载故障；不接小程序、不生成正式分数、不改现有 38 只函数或六项旧业务密钥。前一轮“可以这么做”的授权不自动覆盖新代码哈希和第二次临时 COS 上传。

## 已知事实与本次变更

- 前一轮 `pronunciation-inference` 为 Python3.11 / 1024 MB / 90 秒、客户端 `invoke:false`、触发器 0；新函数代码与本地 253/253 文件哈希相同。匿名与无签名调用均被拒绝。唯一签名 1 秒合成音频事件由平台执行约 646 ms、约 21 MB 后返回 `SERVICE_UNAVAILABLE`，未出现 Vosk 成功摘要；无长音频调用。执行完成后该函数保持 `Active` 且用户环境变量 **0**、`invoke:false`、无触发器，5 份合成文件已按精确 ID 删除，前缀空，原 38 只函数仍 `Active`。
- 旧代码把模型路径配置为 `/var/task/model/...`；[腾讯云 SCF Python 文档](https://intl.cloud.tencent.com/document/product/583/40323)给出 `PYTHONPATH=/var/user:/opt`，[函数层说明](https://cloud.tencent.com/document/product/583/40159/)指出代码解压至 `/var/user/`。因此旧路径与平台代码目录不符，**但不证明故障唯一发生于模型加载**，因为私有 URL 在本机哈希读取成功不等于云函数内可下载。
- 新候选代码以 `Path(__file__).resolve().parent / "model" / MODEL_VERSION` 定位同一包内模型，不注入绝对 `VOICE_MODEL_PATH`。在原 HMAC + 客户端禁调边界下，基准模式增加签名 `modelCheck`（只加载固定模型、返回模型版本与耗时）；对识别路径只返回安全错误阶段 `download | decode | model | recognize` 与有限原因类别（如 `directory_missing`、`http_403`、`runtime_failed`），**不返回/记录临时 URL、文件路径、音频正文、转写、密钥、异常堆栈或学生信息**。业务模式继续返回通用错误，不开放新客户端动作。
- 新 ZIP 仅在 D 盘 `D:\app-m3-cache\voice\pronunciation-inference-diagnostic-py311.zip`：压缩 **49,907,865 字节**、解压 **101,909,297 字节**，SHA-256 `8f8a61dc94505e9268bf91ad73c106cf232ebc43a5cdaea622fa408468111d80`；253 文件逐项清单 SHA-256 `9dc1401a16cd3aa3585ce346ccb68756872f68ca15c59d3bc5d1a668146fb4f9`。模型 ZIP 与 Linux wheel 的许可/版本/原始 SHA 均沿用锁文件，未重新下载。纯模拟专项 5 通过、1 项历史本机模型运行用例跳过，未在本地运行模型。

## 限量操作与费用

1. 只读重核唯一既有非生产环境 `NORMAL`、个人版、`EnableOverrun=false`、`EnvCharged=no`，39 只函数中原 38 只 `Active`、新函数 `Active` 且环境变量 0/客户端 `invoke:false`/触发器 0，套餐剩余额度、私有云存储规则与临时 COS 桶归属。当前 CLI 3.8.2 只能经 `--deployMode cos` 上传这约 50 MB 包；旧环境曾有该临时域名 DNS 失败。前一轮只读确认临时桶 APPID 与用户 CloudAppId 不同；按 COS 桶/对象归属与按桶出账规则推断平台临时对象不计入用户 COS 账单，但须执行前再次核对实际目标桶及账单状态。无法确认零新增用户账单即停。
2. 在 D 盘独立函数目录/只含 `pronunciation-inference` 的配置下，先使用 CLI `fn code update pronunciation-inference --dir <D盘目录> --deployMode cos --json` **只更新这一只内部函数**；不使用 `--all`、镜像、云托管、付费预热或项目默认多函数配置。若 COS DNS/权限失败，只读核对现行函数仍禁调和无密钥，然后停止，不切换未审上传方式。更新成功后只读下载**这一只**函数代码，逐项核对 253/253 哈希；不一致即停，不注入测试密钥。
3. 从 D 盘新生成本轮短期 `VOICE_INTERNAL_SECRET`，仅给这只函数配置 `VOICE_INTERNAL_SECRET`、`VOICE_ALLOWED_MEDIA_HOST`、`VOICE_MEDIA_DOWNLOAD_TIMEOUT_SEC=30`、`VOICE_BENCHMARK_LOG=1`，保持 1024 MB / 90 秒，不设置 `VOICE_MODEL_PATH`。不读取/注入六项旧 `YAREI_*`。再读回仅这些键名、调用禁调与无触发器。
4. 最多 **4 次**管理端 SCF `Invoke(Event)`：先 1 次签名 `modelCheck`，只接受云端日志中的 `voice_model_check` 成功摘要；失败按阶段停。模型成功后才把**一份**约 1 秒、8.6 KB 原创合成 MP3 上传新私有前缀 `m3-voice-diagnostic/2026-10-03/`，下载读回 SHA，再发 1 次签名短音频；最多保留 2 次同类受控复核余量。按 Request ID 用 CloudBase `SearchClsLog` 读取运行、内存、冷/热与安全阶段摘要。`GetRequestStatus`/CLI `fn log` 在前轮返回空，不单独依赖它们；日志查询仍无法对账即停止。**本包不触发 5 分钟样本**。
5. 费用上限按 4 次×1 GB×90 秒约 **360 GB·秒**、不超过 4 次云函数调用，合成媒体与读回远小于 1 MB；另有约 50 MB 的第二次平台临时 COS 代码上传/可能残留。使用现有个人版额度且超限按量关闭，执行前后核对 CloudBase/COS 账单与调用指标；任何额外付费提示立即停。假如临时 COS 反事实由用户按标准存储付费，50 MB 一个月约 ¥0.006，**这不是用户已授权付费的额度**。

## 固定收尾与停止条件

- 不论模型/短音频结果如何，停止主动调用；从新函数清除全部本轮用户环境变量，读回仍为 `invoke:false`、无触发器、原 38 只 `Active`。仅在确实上传了那一份新合成 MP3 时，对它先精确 dry-run，再按**唯一文件 ID**删除并查空；本地临时密钥/签名事件文件按精确路径清理。保留新函数的禁调代码供审计，不触碰旧业务数据或密钥。
- 每步记录时间、环境状态摘要、代码包/远端文件哈希、函数版本/规则、管理端请求 ID 的受限本地映射、阶段化错误、实际调用/GB·秒、临时 COS 上传状态、合成文件及新密钥清理结果。若包哈希不符、原函数状态变化、客户端规则变弱、阶段信息含 URL/正文/密钥、云端额度不足、COS DNS 再失败或日志无法对账，立即按上述固定收尾，**不继续长录音测试**。
- 完成本次故障分层不代表评分质量或小程序端到端通过。只有取得对照儿童录音的合法来源、人工质量门槛及单次/总等待时限另行冻结后，试验分才可能申请正式放行；本包不做这些决定。

按 `AGENTS.md`，这是前轮固定哈希以外的 M3 云端代码更新与第二次临时 COS 上传；须用户针对**此修订包**一次明确授权后方可实施。此前批准的内部基准包已结束，不能复用作为本包授权。
