# 跟读录音上传修复记录（2026-10-17）

## 问题与原因

学生点击跟读录音上传后看到“录音文件无效或超出时长”。既有非生产 `pronunciation-command` 的线上 `sealRecording` 分支仍只接受 MP3。其 `updated.js` 从 2026-10-12 起未包含 WebM/Opus 转码判断；开发者工具可能产生的 WebM/Opus 因此被服务端以 `MEDIA_INVALID` 拒绝。线上 `index.js` 仅将 `sealRecording` 路由到 `updated.js`，其余动作仍走 `legacy.js`。

## 本次改动

- 封存适配器根据实际 EBML 文件头、Opus 编码和容器元数据识别 WebM/Opus，安全转为 MP3 后继续检查大小、时长、哈希和私有路径。兼容 `A_OPUS`、Matroska 等元数据写法；其他格式继续拒绝。
- 小程序在云端明确返回 `MEDIA_INVALID` 时保留本机录音，清除已被拒绝的暂存文件引用和封存操作号，使“重试上传”真正重新上传；其他服务错误仍保留原幂等操作号。

## 非生产执行与回退

目标为既有个人版非生产环境 `cloud1-d8ggzrwwedb786e41`，查询时状态 `NORMAL`、套餐 `baas_personal`；未开通付费功能。更新前只读下载并保留 `pronunciation-command` 完整线上目录于 `workspace/m1-cloudbase/.runtime/pronunciation-remote-20261017/`：路由文件 SHA-256 `4cd098b0e1c4c8fe60e3efd80138b9968bad8a465fec1daea9afeddc44035ea46451fb9c`，旧封存分支 `updated.js` SHA-256 `d92340ebd1fc2e74143d7bf70a677f331f5a2225e7c66b30327b185718ea20cf`，其余动作的 `legacy.js` SHA-256 `4ec376b5627a6f80810f0d3ea5aa116d34a86a71d22842bad395fe08df148b77`。

候选包复制该线上目录，只替换 `updated.js`。更新后函数 `Active`、`CodeResult=success`、Node 运行规格仍为 60 秒和 512 MB，`$LATEST` 路由保持。独立下载线上新代码后，路由、`legacy.js` 与候选哈希一致，新 `updated.js` SHA-256 为 `4c0f3c0b433ddf366a781d4907fdff72b11e2ffc1a12a74a8324f4e49a3e72f7`，包含 EBML/Opus 转码分支。CloudBase 在代码更新期间重新安装固定版本 SDK 的依赖，`qs` 从 6.16.0 升到 6.16.1；线上读回与候选相比有 14 个依赖文件差异，其余目标代码文件匹配。更新未修改业务数据库记录、媒体文件或其他云函数。若需回退，可用上述完整线上备份目录做同函数代码恢复；回退前须再次核对当前版本和环境。

## 验证与限制

- 本地两秒合成 WebM/Opus 样本和 Matroska/A_OPUS 元数据变体均通过封存适配器测试，输出有效 MP3 私有引用。
- CloudBase 本地检查：179 个测试文件、943 项通过。小程序及历史网页后台完整检查：小程序 334 个测试文件、1,443 项通过，网页后台 49 项通过；类型检查、视觉静态契约和构建通过。
- 线上已核对代码读回和函数状态；尚未用学生已登录小程序重新录制并上传同类音频，故不把本次记为云端正向录音闭环或真机验收。AI 试验评分的模型质量与等待时长门槛仍沿原记录追踪。
