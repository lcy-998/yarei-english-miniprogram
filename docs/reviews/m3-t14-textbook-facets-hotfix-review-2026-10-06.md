# T-14 同步学教材筛选接口修复审阅包（2026-10-06）

## 现象与根因

- 教师打开 T-14 时，页面并行请求 `teacher-textbook-query.listTextbooks` 和 `listTextbookFacets`；任一失败即显示错误并隐藏教材列表。
- 非生产环境 `$LATEST` 的 `index.js` SHA-256 为 `53697302B3F67B976B7728D42424C810C2D819D8E7E7B9F1A61C5A593339AE2E`，代码没有 `listTextbookFacets`。旧函数对未知 action 返回 `VALIDATION_ERROR`，其通用文案正是截图中的“输入内容不符合要求，请检查后重试”。筛选均为默认值，因此不是教师输入问题。
- T-14 的完整授权目录筛选候选是 M3 已确认需求；仓库已有本地实现，但该函数尚未更新到云端。

## 本次唯一变更

- 目标：现有非生产 CloudBase 环境中的一只 `teacher-textbook-query` 云函数，仅更新 `$LATEST` 代码；不变更任何集合、数据、函数配置、环境变量、路由或其他函数。不涉及生产环境、真实账号授权、真实个人信息或付费开通。
- 以远端现行完整代码目录为底包，只用 Git 基线加现有 T-14 筛选三处源码构建的新 `index.js` 替换旧入口。新入口 SHA-256 为 `0F0A7BDC33913882CC50806C284086C66D302A1C87F701A5022640C6B6800D23`。新旧包均为 5,486 个文件，逐文件比较仅 `index.js` 不同；生成 JavaScript 的实际差异为 68 行新增、2 行替换，只涉及新 action、请求校验、授权筛选候选服务和分发。
- 本地包：`D:\app-m3-cache\textbook-diagnosis-20261006\facet-deploy-ready`；旧包回退：`D:\app-m3-cache\textbook-diagnosis-20261006\teacher-textbook-query`；隔离单函数、无 `envVariables` 的配置：`D:\app-m3-cache\textbook-diagnosis-20261006\teacher-textbook-query.code-only.json`，SHA-256 为 `CEF7ACE3A38E012D505EEC86159B5299D68211DDE081FC20D06A7BD02D45EE76`。不得用项目默认多函数配置执行更新。

## 执行前核对与费用边界

- 只读 CLI 显示唯一目标环境为 `NORMAL`、个人版、`EnvCharged=no`、`EnableOverrun=false`；函数为 `Active`、Nodejs20.19、`index.main`、10 秒、256 MB、零触发器、`$LATEST` 主路由且无权重版本。已有 6 个环境变量键；只比较键名与配置，不读取或输出值。
- 执行前重新核对目标环境、函数代码哈希、配置/路由、隔离配置及两个包的文件清单。若不符，停止并重审。代码包约 5.9 MB，CLI 可能经平台临时 COS 上传；执行前确认临时桶归属和免费额度/费用条件，不接受未批准的费用。未满足条件则停止。

## 授权后动作与验收

1. 只对 `teacher-textbook-query` 执行 `fn code update`，显式指定上述隔离配置、完整新包和 `--deployMode cos`；不使用 `fn deploy`、配置更新或版本发布。
2. 独立下载 `$LATEST` 读回入口并核 SHA-256；核函数为 `Active`，运行配置、环境变量键名、触发器和路由与更新前相同。
3. 用非生产虚构教师的已登录会话分别请求默认 `listTextbooks`、默认及限定班级的 `listTextbookFacets`，确认可用候选与教师/班级授权一致；错误输入、匿名及跨班请求仍须拒绝。
4. 微信开发者工具中重新打开 T-14，确认教材列表和五级筛选正常显示、查询及重试；如工具窗口不可用，将页面验收明确留待人工完成。

## 回退

- 若新入口读回、配置/权限或云端冒烟不合格，停止其他操作，使用同一隔离配置对这只函数执行 `fn code update`，仅将目录指向上面的完整旧包；读回旧 `index.js` SHA-256 并复核配置/路由和旧 `listTextbooks`。不删除教材、任务、审计或 M1/M2 数据。若旧包无法精确恢复，停止并报告，不切换到多函数部署。

## 已完成的准备验证

- 从云端只读下载当前 `$LATEST`，确认缺少新 action；与 Git 基线构建包相比，除构建路径注释外完全一致。
- 当前本地 CloudBase `npm run typecheck` 通过；`npm test` 153 文件、802 项通过；40 个函数本地构建通过。这些结果不代表已完成云端部署或微信页面验收。

## 授权与实际执行

- 用户在本任务中阅读上述单函数范围后，明确授权“更新并验证”既有非生产环境。本次授权只覆盖本审阅包；未触及生产、付费开通、真实用户数据或其他 M3 函数。
- 执行前再次下载 `$LATEST`，其入口与已备份旧包哈希相同；隔离配置与目标环境匹配。只读核对环境仍为 `NORMAL`、个人版、`EnvCharged=no`、`EnableOverrun=false`；本机 CLI 的临时代码 COS 桶所有者不同于当前账号；`DescribeCreditsUsage.ReportValue=0`。旧额度监控接口的 `MetricData` 为空，因此未以它声称精确剩余额度。超限按量关闭，未开通付费。
- 仅对 `teacher-textbook-query` 执行一次 `fn code update --deployMode cos`，返回 `Code updated`。随后独立下载 `$LATEST`，`index.js` SHA-256 与新包 `0F0A7BDC33913882CC50806C284086C66D302A1C87F701A5022640C6B6800D23` 一致；函数 `Active`、Nodejs20.19、`index.main`、10 秒、256 MB、原 6 个环境变量键、零触发器、`$LATEST` 主路由和零权重路由均保持。
- 真实云函数匿名探针：合法 `listTextbookFacets` 返回 `UNAUTHENTICATED`，带伪造筛选字段返回 `VALIDATION_ERROR`，原 `listTextbooks` 仍返回 `UNAUTHENTICATED`。这证明新增 action 已进入远端校验与会话门禁，且旧列表 action 仍在；探针没有业务写入。
- 当前执行环境没有可用的虚构教师测试密码，也没有可控的微信开发者工具已登录窗口。故**已登录教师的正向目录/五级筛选与页面点击尚未完成验证**，不记为通过；后续用虚构教师登录 T-14 检查两册课本、授权班级筛选和列表/筛选结果。未因缺少这项证据改动数据或回滚已经通过代码、配置及匿名门禁核对的修复。
