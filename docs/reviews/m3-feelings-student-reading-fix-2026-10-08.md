# 学生端《Feelings》阅读错误修复（2026-10-08）

## 结论

故障来自代码与非生产云函数版本不一致，不是《Feelings》的页图或阅读任务快照有误。资源、任务冻结快照的 7 页 `pageId`、`chapterId`、页码均对应一致。

学生从课堂任务进入 S-04 时，小程序调用 `content-query.getHistoricalTaskLearning` 读取本人任务冻结页图。线上 `content-query` 原代码不含该 action；同一无会话函数探针返回 `VALIDATION_ERROR`，`fieldErrors.action` 为“不支持的操作”，其通用文案与学生看到的提示一致。此外，本地历史学习服务原先只接受“全教师公共目录且已审核”的阅读快照，会拒绝用户已批准用于非生产验收的私有《Feelings》任务快照。

## 修改

- 对本人已分配任务中的阅读项，允许按任务冻结快照读取页图并签发临时地址；服务仍先校验学生身份、任务和任务项关系，客户端不能提供资源或云文件 ID。
- 未通过审核的朗读/跟读音频不从任务快照签发；词包仍要求原公共源审核与完整映射条件。
- 只更新既有非生产 `content-query` 函数代码，没有写入阅读资源、任务、学生进度或权限数据。

## 验证与云端执行

- `tests/org-content/historical-task-learning.test.ts`：4 项通过。
- `npm run typecheck`（`workspace/m1-cloudbase`）：通过。
- 旧函数匿名探针返回 `VALIDATION_ERROR` / `action: 不支持的操作`；更新后相同 action 返回 `UNAUTHENTICATED`，表示 action 已识别且无会话请求仍被拒绝。
- 云端 `$LATEST` 从 SHA-256 `5dbad2838ae3d8bc9884d43d85079433e67e14369233c187c90dd135ee8d4dcd` 更新为 `47aec2ceec28ba9f41655c433d7e1c38518e9598d19688b16d78e34ccef557ed`，状态 `Active`。Nodejs20.19、10 秒、256 MB、`InstallDependency=FALSE`、六个环境变量键、零触发器及 `$LATEST` 路由与更新前一致；非生产环境为个人版，超限按量关闭。
- 首次部署尝试触发 CLI 自动把 `InstallDependency` 改为 `TRUE`，该次代码已回滚，并使用备份恢复原配置；最终成功版本以 COS 上传，完整依赖树复用自部署前代码备份。最终读回确认代码哈希和配置一致。

尚未取得虚构学生已登录小程序页面的重新点击证据，因此本记录不宣称实际页面验收通过。学生再次打开《Feelings》任务时应能读取页图；如果页面仍报错，需记录新的页面步骤和请求时间继续定位。
