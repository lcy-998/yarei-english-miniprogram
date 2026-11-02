# 阿里云运行适配

该目录把 0.128.0 业务函数注入到本地数据库、认证、媒体和模型运行时。完整实测和交接见 `../../docs/deployment/aliyun-2026-11-02.md`。

本机构建需先在 `workspace/`、`workspace/m1-cloudbase/` 和本目录执行 `npm ci`，然后 `npm run typecheck && npm test`。`npm run build` 生成独立 Node 22 CJS 发布文件，无需将开发依赖上传服务器。Python 模型与已校验的 Linux 运行包独立存放，不能从开发机器的 Python 包替代。

运行环境：`YAREI_DATA_DIR`、`YAREI_ORIGIN`、`YAREI_STORAGE_NAMESPACE`、`YAREI_INFERENCE_ROOT`、`YAREI_PROMPT_VERSION`；正式服务设置 `YAREI_MAINTENANCE=1`。默认仅监听 loopback；反向代理必须覆盖 X-Real-IP。服务端密钥在私有 secrets.json，禁止写入环境示例或仓库。

迁移工具 `tools/migrate.py` 只允许新的空目标目录，原目录完全不写入。迁移前必须核对环境、导出数与媒体哈希。`tools/cutover.sh` 是本次有固定路径的执行记录，不应不经检查重复运行。

密码重设：把 `{ "uid": "目标平台身份ID" }` 放在 mode-0600 私有文件；停止服务并备份后，以 `YAREI_DATA_DIR` 和 `YAREI_ACCOUNT_FILE` 指向相应目录/文件运行发布目录的 `operator.cjs reset-password`。新密码保存在数据目录内的私有 reset 文件，重新启动服务。不要把密码放进命令行。新建账号初始密码在 `account-delivery/`。

密码、数据快照及媒体不进入 Git。备份文件不是公开管理 API，网页目录不得包含业务数据库或交付密码。
