# M3 教师 AI 温暖评语 teacher-v10 非生产部署（2026-10-18）

## 部署范围

- 仅更新既有非生产 CloudBase 环境 `yarei-m1-dev`，只用一条虚构英语习题证据做推理冒烟；未触碰生产环境或真实学员数据。
- 部署直接面向学生的评语生成、最小作答证据投影、证据不足状态、输出引用校验及 `teacher-v10` 提示词；教师确认发布边界不变。
- 更新 `teacher-suggestion-inference-trial`、`teacher-suggestion-command`、`teacher-suggestion-worker`、`review-command`；将 `submission-command` 与三个建议运行函数的 `QWEN_TRIAL_PROMPT_VERSION` 从 `teacher-v9` 改为 `teacher-v10`。其他环境变量值未变。

## 部署读回

| 函数 | 最终状态 | 代码 SHA-256 / 读回 | 配置与路由 |
| --- | --- | --- | --- |
| `teacher-suggestion-inference-trial` | Active | `index.py`：`67dd412a36f75b1c6bf56c6c5edc53aa53362283d352a41bd9069e27b3698f63` | Python 3.11，1024 MB，210 秒，依赖自动安装关闭，`$LATEST` |
| `teacher-suggestion-command` | Active | `index.js`：`227f2322151ab2d3a4e8d59fefb8e216decfe26200c110b159713019d1569cc2` | Node.js 20.19，512 MB，240 秒，依赖自动安装关闭，`$LATEST` |
| `teacher-suggestion-worker` | Active | `index.js`：`974ada9c89ff4f8aa71b6725a2f9ffe02830f6a13706b5213167f52f6ef2ef39` | Node.js 20.19，512 MB，240 秒，依赖自动安装关闭，`$LATEST` |
| `review-command` | Active | `index.js`：`db8ef15dbc6feb3cc565c2680b84d6a7716abd67cc3fb477425d680665157d3d` | Node.js 20.19，256 MB，20 秒，依赖自动安装关闭，`$LATEST` |
| `submission-command` | Active | 未改代码，原 SHA-256：`dcf6bcaed01f7093ca546b165cca8b7832417ea3abfd422ee0b909965499e153` | Node.js 20.19，256 MB，15 秒，依赖自动安装关闭，`$LATEST` |

五个函数均无触发器，路由仍为 `$LATEST` 且没有额外流量权重；没有修改 ACL、集合、业务记录或人工点评。提示词版本读回为 `teacher-v10`，生成/推理代码不再将旧 `actionCode` 方案作为当前输出契约。

## 回退与费用核对

- 部署前为旧 `$LATEST` 保存了回退版本：推理函数 v7、建议命令 v11、建议 worker v3、`review-command` v10、`submission-command` v4；发布这些版本没有改变函数路由。
- 推理包清单 SHA-256 固定于 Qwen 模型 `da2572f16c06133561ce56accaa822216f2391ef4d37fba427801cd6736417d4` 与 llama.cpp 引擎 `f7e86d010fcaa6082772f2a8d0dea0f887571f43f7575dc3b267ef0aa2c8b613`。候选包解压后 440,034,858 字节，低于 500,000,000 字节的普通函数包限制。
- 部署前后 CloudBase 环境保持个人版、`EnableOverrun=false`、未开通按量和未标记已付费；最后一次资源点读数为 0。计费报表可能延迟，不能据此承诺后续账单为零。
- 首次代码更新曾将建议命令的依赖自动安装标记改为开启；已在继续部署前恢复，并读回确认五个函数均为 `InstallDependency=FALSE`。后续代码更新通过隔离配置执行，仅改代码且保留该设置。

## 实际验证

- 推理函数健康调用通过：模型哈希核验成功、运行时可启动，返回 `teacher-v10`，约 2.4 秒。
- 一条虚构证据的云端生成通过：返回 128 字评语、引用当前证据，并回应学生答案与参考答案；单次约 95.5 秒。测试只直接调用隔离推理函数，没有写入建议/点评集合，也没有发布反馈。
- 生成服务的本地回归测试、T-08 页面状态测试及本地类型检查在部署前已通过；部署后没有再运行完整项目测试。完整教师登录后的 T-08 生成、采纳、人工发布流程，以及教师双评样本集、真机与弱网验收仍未完成。

## 当前判定

`teacher-v10` 已部署到既有非生产环境，并通过一次签名健康调用及一条虚构证据生成冒烟。这证明模型与新输出契约可运行，不代表评语质量正式验收、生产开放或自动发布获准。所有生成内容仍是教师确认前的建议草稿。
