# M3 Vosk 跟读本地验证记录（2026-10-02）

> 仅使用 D 盘缓存、原创虚构合成英语录音和本地代码；未使用儿童录音，未部署云函数，未改非生产数据。本记录是技术证据，不是正式发音评分质量验收。

0.62.0 后用户明确模型只在 CloudBase 云端运行/测试；下述 Windows 推理数字是该决定前形成的**历史观察**，此后本机只做静态包、许可、哈希和纯契约检查，不再以 Windows 模型运行推进验收。

## 固定制品

| 制品 | 来源、许可与固定版本 | SHA-256 |
| --- | --- | --- |
| 小英语模型 ZIP | [Vosk 官方模型清单](https://alphacephei.com/vosk/models)及其下载地址；`vosk-model-small-en-us-0.15`；Apache 2.0 | `30f26242c4eb449f948e42cb302dd7a686cb29a3423a8367f99ff41780942498` |
| Vosk Linux x86_64 wheel | [PyPI vosk 0.3.45](https://pypi.org/project/vosk/0.3.45/)；Apache 2.0 | `25e025093c4399d7278f543568ed8cc5460ac3a4bf48c23673ace1e25d26619f` |
| miniaudio Linux CPython 3.11 wheel | [PyPI miniaudio 1.70](https://pypi.org/project/miniaudio/1.70/)；MIT | `770ece1f3a1d6d0c8e0ce17c444b0e46b919e85389d4ef26ea8e354c0de1b840` |
| 其余 Linux wheels | 精确文件名、版本和逐包哈希见 `workspace/m1-cloudbase/voice-inference/dependencies.lock.json`；只从所列本地文件离线构建 | 见锁文件 |

目标为 [CloudBase 普通云函数 Python 3.11](https://docs.cloudbase.net/cloud-function/runtime-support)。离线包 `D:\app-m3-cache\voice\pronunciation-inference-py311.zip`：压缩后 **49,907,445 字节**、解压后 **101,907,192 字节**，包 SHA-256 为 `121cdf79624c678a52d1953831076c3c45198928688699b2e49f07dca0278e47`。构建时采用 ZIP 最高压缩级别，并省去该识别 worker 不导入的 `websockets` 运行文件；源 wheel 仍在锁文件中固定和校验。当前 CLI 的直接 ZIP 路径只允许约 1.5 MB，本包只能按另审的临时 COS 部署方式上传；压到 50 MB 以下不代表 CLI 直传可用。构建时逐一验证模型及 wheel 哈希；模型和虚拟环境未进入 Git 或小程序包。D 盘下载前约剩 3.94 GB，首次完成包后约剩 3.63 GB。

## 本机 Windows 可行性结果

使用 `workspace/m2-acceptance/2026-09-29/assets/recording-example.mp3` 的本机英语合成语音，及由对应 WAV 在 D 盘生成的静音、1 秒、噪声和约 299 秒样本。`miniaudio` 解码成 16 kHz、16 位、单声道 PCM 后由 Vosk 离线识别。基准函数不做云下载、业务鉴权和端到端网络调用。

| 样本 | 本机 Vosk 结果 | 耗时与内存证据 |
| --- | --- | --- |
| 4.629 秒合成朗读 | 识别 9 词 | 初次/热运行 1.78/1.51 秒；加进程内存监测后为 4.31/3.03 秒，峰值 RSS 约 176 MiB |
| 1.071 秒静音 | 0 词，应由评分域返回 `unreliable` 且无分数 | 0.83/0.33 秒 |
| 1.071 秒合成朗读 | 5 词 | 1.18/0.72 秒 |
| 4.702 秒加噪合成朗读 | 7 词 | 2.03/1.46 秒；不将词数当作儿童发音质量证据 |
| 299.076 秒重复合成朗读 | 约 582—583 词 | 无监测约 14.17/13.74 秒；有内存监测及不同批大小时约 19.06—21.81 秒，峰值 RSS 约 227—230 MiB |

Python 私有入口专项 3/3 通过：无签名/错误签名/过期签名拒绝、非允许媒体域名拒绝、MP3→PCM 静音识别。TypeScript 语音契约与服务专项 9/9 通过：本人/角色、快照变更、幂等、静音、失败后同录音重试、五次有效上限、本人历史列表及教师受控只读；虚构密钥轮换影响的纯逻辑模拟另 2/2 通过。CloudBase Node 包构建专项 4/4 通过。后端 `npm run check` 于本轮通过 104 文件/632 项，根工程 `npm run check` 通过 204 文件/974 项（含管理后台 49 项）；两项轮换模拟是在该次全量检查后单独运行，未冒称包含在原统计内。

## 阻断与未测

- **云端实际时延尚未测得**：约 5 分钟样本仅 Windows 本机推理就落在 13.7—21.8 秒区间，未加入目标云函数冷启动、私有录音下载、Node 鉴权和结果落库。用户现已放宽原 15 秒硬门槛；本区间只说明需在云端按 1 秒至 5 分钟各样本测真实耗时，再设合理等待/超时，不可缩短录音上限或伪造分数。
- **Linux 目标尚未执行**：本机无 WSL 发行版或 Docker/Podman；已构建 Linux CPython 3.11 轮子包，但没有在 Linux 运行其 native 库。普通云函数内存、冷/热启动、实际 `callFunction` 回执和安全规则也尚无目标环境实测。
- **质量尚未验收**：静音与有限合成样本只能证明解码/识别管线；尚无合规儿童录音、人工双评、相关性/误差、口音/设备/噪声及成功率 95% 对照。Vosk 分数继续标“试验性”，不进入正式任务或打卡。
- **实际额度尚未读取**：只读云环境核验显示唯一既有个人版环境 `NORMAL`、`EnableOverrun=false`、`EnvCharged=no`，38/38 既有函数为 `Active`、当前无语音函数。此状态不等于剩余调用、计算、存储和流量额度充足。

用户已明确不使用本地 Linux、WSL 或容器。0.62.0 取消固定 15 秒硬门槛；后续只在受控 CloudBase 普通函数限量测 Linux 包加载和 299 秒样本，并据实确定学生可见等待上限。独立内部基准与额度/回退范围见 `m3-vosk-cloud-only-benchmark-review-2026-10-02.md`；完整业务接线仍另审。
