# 《At School》跟读开始录音不可用修复（2026-10-21）

## 症状与定位

- 用户在海尼曼 GK《At School》点击“开始录音”后看到“服务暂不可用，请稍后重试”。
- 只读核对唯一既有非生产 CloudBase：环境 `NORMAL`、个人版、未付费、超额计费关闭；执行前函数调用 5,196、数据库写入 2,078、读取 16,767，低于项目停止线。两组织已发布投影的内容版本均为 `1.1`，第 3–11 页共 9 个跟读句段已审核；示范音频短期地址 9/9 均可签发。
- `content-query`、`pronunciation-query` 和 `pronunciation-command` 均为 Active。原线上命令包的 `index.js` 将 `beginRecording`、`beginScore` 转给 `legacy.js`，仅将 `sealRecording` 转给 `updated.js`。无会话有效请求应在身份校验处返回 `UNAUTHENTICATED`；原来前两项直接返回 `SERVICE_UNAVAILABLE`，上传分支则正确返回 `UNAUTHENTICATED`。
- 受控短时诊断只记录异常类别，依次定位到旧包初始化和身份解析的 `ReferenceError`。对下载包核查发现 `legacy.js` 引用了却没有定义 `createOrgContentDocumentRepository`、`isTrustedPlatformIdentity`。旧包由不同阶段代码拼接，包体内部引用不完整；异常被现有兜底规则统一映射为“服务暂不可用”。

## 修复与受控变更

- 本地源码将未启用的视频处理服务改为按需创建，使跟读命令函数不为无关的教师私有视频处理初始化。
- 以当前源码重新构建完整 `pronunciation-command`，确认包内包含上述两个符号定义、WebM/Opus 上传封存兼容和 90 秒后幂等评分重派逻辑。仅替换既有非生产 `pronunciation-command` 的代码，未部署其余函数，未改变内存 512 MB、超时 60 秒、Nodejs20.19、`index.main`、环境变量、触发器、角色或 `$LATEST` 路由。
- 部署前下载原线上包作回退。短时诊断包和一次因大包 `CodeInfo` 空值而误判的候选更新均已回退；最终改为下载完整线上包校验。最终线上 `index.js` SHA-256 为 `202541bb34de9e482b205e80372fb82a5f16ac1affffc18d4633c24f090e12e5`，独立下载读回一致，函数状态为 Active。回退包留在本地受控运行目录。

## 验证与边界

- 云端无会话探针：跟读句段查询、录音创建、录音封存、请求评分和评分查询均返回预期的 `UNAUTHENTICATED`，不再返回 `SERVICE_UNAVAILABLE` 或 `INTERNAL_ERROR`；无会话探针没有创建录音或改动学生数据。
- 后端类型检查通过；全量测试 181 文件、962 用例通过。
- 未取得已登录虚构学生会话，因此尚未在小程序中完成《At School》实际录音创建、上传和评分闭环；本记录不将无会话探针当作登录态或真机验收。未修改生产环境、小程序正式版本、真实学员数据、费用或供应商凭据。
