# M3 T-19/T-20 安全扫描与转码零增费可行性审阅（2026-10-03）

> **结论：当前不能证明完整上传→病毒扫描→音视频转码可在既有非生产环境零新增费用内通过，故不得给媒体 `scanStatus=clean`、`transcodeStatus=ready` 或上架。** 本文只做静态/只读分析，不开通服务、不部署函数、不读取用户媒体内容、不在本机运行 Linux/WSL/Docker，也不改变现有草稿。已有三题听力、视频与绘本样本的哈希/人工内容复核不能替代这两个技术状态。

面向用户的三选项、4 GiB 短样本规格、计算参考价与不可封顶原因见 `m3-teacher-media-cloud-decision-2026-10-03.md`。

## 云端执行路径

| 路径 | 可行性证据 | 当前阻断 |
| --- | --- | --- |
| CloudBase 普通云函数自托管 ClamAV + FFmpeg | [ClamAV 官方文档](https://docs.clamav.net/manual/Usage/SignatureManagement.html)明确扫描引擎先要官方签名库，`freshclam` 持续更新；[FFmpeg 法律说明](https://ffmpeg.org/legal.html)区分 LGPL/GPL 构建。 | 尚无固定版制品、签名库/哈希、目标 ABI 与大文件实测；[ClamAV 官方容器说明](https://docs.clamav.net/manual/Installing/Docker.html)建议至少 3 GiB/优选 4 GiB，[CloudBase 普通函数配置](https://docs.cloudbase.net/cloud-function/function-configuration/config)最高 3072 MB，连最低建议都没有可靠余量。此路径不作为当前零增费可执行方案。 |
| CloudBase 云托管云端构建 ClamAV + FFmpeg | [CloudBase 云托管部署方式](https://docs.cloudbase.net/run/deploy/deploy/introduce)支持上传代码或 Git 仓库后**在云端构建镜像**，无需用户电脑运行 Linux/WSL/Docker；可把扫描、签名库及转码器放进隔离容器，并按源扫描→转码→产物扫描编排。 | [云托管具体限制](https://docs.cloudbase.net/run/limitation)要求开启环境级超限按量，CPU/MEM 不含当前环境套餐，HTTP 最长 60 秒/请求体 20 MB；当前非生产 `EnableOverrun=false`。4 GiB 短样本可作付费候选，但正式 30 分钟/500 MB 媒体须另设异步处理。构建/镜像/签名更新/出流量价与环境级硬止损未核，不能把实例参考价当总价上界，当前不部署。 |
| 腾讯云 COS/CI 云查毒与转码 | 官方[媒体处理费用](https://cloud.tencent.com/document/product/436/58966)明确音视频转码按量计费。 | [CI 云查毒接口](https://cloud.tencent.com/document/product/436/63961)列出的支持格式是文档、程序、压缩包等，**没有 MP3/AAC/MP4**；不能把内容安全“音频/视频审核”当作病毒扫描。即使另找能扫描媒体的产品，开通/计费及本环境赠额仍未证实，不提交任务。 |

## 如继续零增费自托管，应先完成的具体静态包

1. 固定 ClamAV 与 FFmpeg 的官方可验证源码/制品版本、每个文件 SHA、许可和构建开关；扫描签名库必须有可信来源、版本、更新时刻、签名校验与本轮最大年龄。FFmpeg 不得无意包含使项目发布承担额外 GPL/非自由义务的构建组件。项目负责人须对许可和媒体版权作最终决定。
2. 在 D 盘只做静态归档和 ELF 依赖检查，统计运行库、签名库、FFmpeg、业务包装合计；不在用户本机运行 Linux 程序。按**至少 3 GiB 且签名更新峰值仍不触顶**为硬门槛，优先审云托管是否可提供 4 GiB 级受控容器；普通函数 3072 MB 上限不能凭包体小就准入。签名库体积的官方 HEAD 读取在本轮未成功，故当前不能填包体预算。
3. 只在另行完成的内部基准审阅包获用户一次明确授权后，于既有非生产 CloudBase **隔离且客户端 `invoke:false`** 的函数用 1 条原创合成 MP3、1 条原创短 MP4 和 EICAR 公开测试串检验：原始文件先扫描/EICAR 阻断，再隔离转码，输出重新哈希并再次扫描；核对 MP3/AAC 与 H.264/AAC 的真实输入→输出哈希/时长/编码、失败/超时/重试、冷/热内存和调用资源。EICAR 只能作测试信号，不代表所有恶意文件覆盖。内部函数须使用全新隔离鉴别，不注入已要求维持的六项旧业务密钥。
4. 执行前同时核对当前个人版函数与数据库/存储余额、目标上传桶及签名更新流量归属、`EnableOverrun=false`、最坏调用/GB·秒/存储上界与账单延迟；任一不能证明零新增费用即不执行。基准通过仍须独立人类版权审核、T-19/A-08 手机视觉批准和业务函数/页面联调，不能直接发布三类任务。

## 最小需要用户决定的后续分叉

- 若云托管云端构建的静态包和内部云端基准最终满足权限、时延、签名新鲜度及经核实的费用上界，另编制精确 T-19/T-20/A-08 施工包，获一次授权后实际接业务上传与审核。
- 若云托管不满足，须由用户决定有费用上界且**确实支持媒体病毒扫描**的其他云服务组合，或缩小/延期 M3 该切片；在决定前保持媒体草稿和服务端发布阻断。当前不请求含糊的“先开通试试”授权。
