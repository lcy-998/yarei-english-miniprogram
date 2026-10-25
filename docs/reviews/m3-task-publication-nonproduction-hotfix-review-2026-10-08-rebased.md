# M3 课堂任务发布故障：现行代码基线上的非生产修复审阅包（2026-10-08）

> 状态：**已在同范围授权下执行完毕**。目标函数代码、配置、路由及虚构单人发布—查询—软回收通过；详见 `m3-task-publication-hotfix-execution-2026-10-08.md`。旧哈希包按停止条件结束并重新审阅，未覆盖并行新增的公共习题来源保护。

## 1. 新基线与范围

- 现行既有非生产 `task-command` 为 `Active`、Node 20.19、20 秒/256 MB、依赖自动安装 `FALSE`、零触发器、`$LATEST` 零权重路由，六项共同业务环境变量与现行 `content-query` 值一致。新基线代码 SHA-256 为 `ad0a4bf3c21dd4ba9e436c108bd3084f1ddd67b6283374a854dc4e9927336bdd`。
- 与旧包基线相比，现行代码另含公共习题投影的来源存活校验。本包**完整保留**该保护，仅在资源解码处补齐顶层词包 `grade/term/textbook/unit/words` 的任务快照投影，并修正已核验阅读版权状态从资源顶层传递、冻结到新快照。不放宽权限、媒体、音节、版本或发布对象校验。
- 用户选定的《Feelings》阅读、VOA 听力、课堂录音、NASA 视频及 Unit 2 词包现有两份草稿继续保持原样；本包不代用户发布至 36 人。当前本地代码加只读真实非生产资源的五项快照冻结为 5/5 通过，尚不证明云端发布通过。

## 2. 冻结制品与安全更新方式

`workspace/m1-cloudbase/tools/prepare-m3-task-publication-hotfix-20261008.mjs --rebased` 从现行线上代码生成仅局部替换的 `index.js`；`prepare-m3-task-publication-rebased-full-package.mjs` 以此前已完整下载、SDK 3.18.3 的函数包为依赖底座，分别本地冻结当前基线完整包与候选完整包。目标目录位于 `D:/app-m3-cache/task-publication-hotfix-20261008-rebased/`，含 `baseline/`、`candidate/` 和最小隔离 `cloudbaserc.json`；每包仅 `index.js`、`package.json`、完整 `node_modules/`。

| 制品 | `index.js` SHA-256 | 字节数 |
|---|---|---:|
| 当前基线完整包 | `ad0a4bf3c21dd4ba9e436c108bd3084f1ddd67b6283374a854dc4e9927336bdd` | 824825 |
| 修复候选完整包 | `6d3283b71c24517222bc19759d0c45392660c134ba19988f2578a931cade4750` | 825791 |

前轮 CLI `fn code update` 在仅含环境 ID 的隔离配置下，把 Node 函数的 `InstallDependency` 默认改成 `TRUE`；本包的隔离配置显式列出唯一函数 `task-command` 且 `installDependency:false`。已核对本机 CLI 3.8.2 的代码路径：该字段进入 `UpdateFunctionCode` 的 `InstallDependency=FALSE`，仍只走代码更新接口，不重填环境变量或更改路由。腾讯云官方 [更新函数代码](https://cloud.tencent.com/document/api/583/18581) 和 [更新函数配置](https://cloud.tencent.com/document/product/583/18580) 均明确列出此标志。候选 JS 语法、词包投影/阅读门槛提取验证通过；CloudBase 858 项、根工程 1329 项、历史网页后台 49 项及构建检查已通过。

执行补充（2026-10-08）：CLI 的 `--deployMode zip` 对完整约 5.7 MB 压缩包返回自身 **1.5 MB** 上限错误，线上代码和配置未变；已停止该命令。腾讯云官方 `UpdateFunctionCode` 的 `ZipFile` 参数支持最多 20 MB，本包改用同一代码更新接口的直接 TC3 签名 JSON 请求，完整候选 ZIP 为 5,693,284 字节，Base64 请求体小于 10 MB；不使用 COS 临时对象、不改变函数或数据库操作范围。`tools/direct-m3-task-publication-zip-update-20261008.mjs` 只读取临时凭据到进程内，显式发送 `InstallDependency=FALSE`，不输出密钥、签名或 ZIP 内容；同一签名路径的 `GetFunction` **只读探针已通过**。新方式若代码或配置读回不符，仍以相同接口和完整基线 ZIP 回退。CLI 更新方式已禁用执行入口，避免再触发 1.5 MB 限制。

## 3. 本次授权覆盖的操作

1. 再次只读核对同一非生产个人版、状态、免费额度、超限按量关闭，现行函数代码必须仍等于新基线哈希；完整运行配置、六项环境变量的**内存摘要**、路由、依赖安装标志和完整回退包必须匹配。任一差异即停，绝不覆盖并行更新。
2. 仅用上述 `candidate/` 完整包对应的候选 ZIP 经官方 SCF `UpdateFunctionCode` 的 `ZipFile` 代码更新接口替换 `task-command`，显式设 `InstallDependency=FALSE`、`Publish=FALSE`。读回目标哈希、`Active`、依赖安装 `FALSE`、其他运行配置/环境变量值摘要和 `$LATEST` 路由全部一致后，才进入测试。配置漂移或候选代码不一致时立即用 `baseline/` 完整 ZIP 同方式回退，并读回基线哈希与完整配置；回退失败则停并报告。
3. 仅用现有虚构教师、已授权的一名虚构学员及这五项资源创建**至多一份单人测试草稿**，发布后经学生本人及教师授权查询核对，再对测试任务软回收。另做未核验阅读与越权资源的只读拒绝探针。新增函数调用最多 12 次，额度/费用有疑问即停。测试产生的审计与软回收记录保留；不修改、回收或发布用户两份现有草稿。
4. 若测试失败、发现越权或其他异常，停止进一步业务调用，并按第 2 步恢复基线代码与配置。若并行任务在此期间再次更新同一函数，停步并重新审阅，不用旧包覆盖新代码。

不含生产、真实个人信息、付费、密钥获取或轮换、素材修改、数据库迁移、账号赋权、小程序体验版上传或正式提审。

## 4. 授权记录

用户 2026-10-08 对原具体审阅包回复“同意”。按项目 `AGENTS.md` 的同一范围授权持续有效规则，本修订保留同一函数、数据类别、最多一份虚构单人草稿、调用上限和代码回退，未扩张施工范围。旧包代码哈希变化已触发停止与重新审阅，本修订预检通过后继续执行该授权；若线上代码再次变化、费用状态改变或需扩大操作清单，立即停止并重新确认。
