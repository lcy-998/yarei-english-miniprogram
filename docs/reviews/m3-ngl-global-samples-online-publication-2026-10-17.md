# 两套 NGL 全球版官方样章网上取得与上架记录（2026-10-17）

## 结论

根据用户已确认的五类指定素材使用权限和“直接从网上获取未获得的资源”指示，自 NGL 官方网站取得两份全球版 PDF，并分别制作为一组五题的学生可独立完成习题，沿已核对的教学内容通道上架：

| 目录标题 | 教材来源 | 年级 | 题组 ID | 范围 |
| --- | --- | --- | --- | --- |
| 环球少年英语（Our World 2e 全球版教学样章）- My Body | Our World 第二版全球版第 1 级 | 三年级 | `exercise_pack_ow2e_l1_u7_global_20261017_v1` | Unit 7，身体部位、can 与雕塑短文 |
| 新时空英语（Time Zones 3e 全球版样章）- Strange Animals | Time Zones 第三版全球版第 1 级 | 七年级 | `exercise_pack_tz3e_l1_u3_global_20261017_v1` | Unit 3，动物伪装短文 |

两组均显著标注“全球版样章”，只代表样章范围，不冒称江苏凤凰教育出版社国内版整册及其配套媒体。原始 PDF 留在 G 盘 `inbox/`；题目为 Codex 根据所列来源自编，题干自带作答所需信息，教师以整组五题选择为一个任务项。

## 来源与实质审核

- Our World 官方 [Student’s Book Walk-through and Resources](https://www.eltngl.com/assets/downloads/ourworld2_pro0000009113/unit_walkthrough_resources.pdf)，本地 `G:\英语资产\inbox\ngl-ourworld-timezones-official-global-samples-2026-10-17\ourworld2-starter-walkthrough.pdf`，60 页，SHA-256 `b974d2086fdfff6b77b067b7e6434f180a3fedb637096c15a55ce26b8ef569cf`。PDF 第 7–10 页展示全球版第 1 级 Unit 7；印刷第 116–117 页身体部位、第 120 页物主代词、第 123 页 can、第 124 页《Sculptures Are FUN》。Codex 对实际页图和文字层交叉核对五题的题干、唯一答案、解析、年级与适龄性。
- Time Zones 官方 [Third Edition Sampler](https://www.eltngl.com/assets/downloads/tz_pro0000009123/ngl_elt_tz3e_sampler_web.pdf)，本地 `G:\英语资产\inbox\ngl-ourworld-timezones-official-global-samples-2026-10-17\timezones3e-sampler.pdf`，12 页，SHA-256 `20ce1ed10682c0611e1fe44de6cde5d3c6fb4f7578f9a4385ba748c37fe8cef6`。PDF 第 10 页是印刷第 36–37 页完整短文《Strange Animals》，说明叶海龙与猫头鹰如何利用与环境相近的颜色隐藏。Codex 对实际页图和文字层核对五题的事实、答案、解析与适龄性。
- 权限依据为用户在本任务内的明确确认，逐组与具体官方 PDF、应用内教学用途及全学校分发范围绑定；不从“网页公开”推定许可，不虚构合同编号。内容包留有来源、PDF 快照、哈希、版权记录、学生无答案预览、逐题审核和版本化清单。两组没有引用未核实的音频或视频。
- G 盘内容包分别位于 `G:\英语资产\library\derived\ourworld2-level1-unit7-global-exercises-20261017\v1\` 与 `G:\英语资产\library\derived\timezones3e-level1-unit3-global-exercises-20261017\v1\`；五份题目导出各位于 `G:\英语资产\exports\wechat\ourworld2-level1-unit7-global-20261017-v1\`、`G:\英语资产\exports\wechat\timezones3e-level1-unit3-global-20261017-v1\`。流水线 `processed=12, skipped=2883, failed=0`，十题均为 `publish_ready`。

## 发布前检查与读回

- 唯一核对的环境为 `cloud1-d8ggzrwwedb786e41`，个人版、超量计费关闭；两份 `inspect` 检查组织范围、临时凭据、目标空位、内容/审核/权限哈希及软下架回退点。检查时配额计数为 `DbWritepkg=189`、`DbReadpkg=2922`、`FunctionInvocation=2169`。
- 每组写入五条公共来源、五条跨组织投影、十条审计记录。两次独立 `verify` 均读回 10/10 内容与 10/10 审计，两所测试组织教师题库各见完整五题；题库摘要不含答案与解析。五类指定素材云端审计扫描 551 条资源记录：环球少年英语、新时空英语、阅读探索者和 Phonics Monster 1 各有一组五题处于发布态，SSS 儿歌仍为零。
- 只发布教学内容；未部署云函数、修改生产基础设施、授权真实账号、上传体验版或发布小程序正式版本。

## 验证与余项

- G 盘流水线单元测试 34/34 通过；教师题组选择页面合约测试 1/1 通过；两份发布脚本语法检查、内容包脚本编译检查通过。未做真实微信账号或真机页面验收。本次没有把这些文本题组当作完整国内教材或音视频课程验收。
- 环球少年英语和新时空英语的**国内版**完整教材及音视频仍需能访问的出版社资源包。Cengage 官方[平台说明](https://support.cengageasia.com/help/en-us/12-olp-avallain/56-)要求学校申请账号，学生还要纸书激活码；旧 Our World 配套站点已[标为停用](https://www.eltngl.com/sites/ourworld/student-resources)。国内版阅读探索者仍缺官方源文件；现有题组是 Reading Explorer 3e 全球版样章。
- Phonics Monster 1 第三版 Unit 1 官方预览五题组已于本任务前一阶段上架；整册和 MP3 仍在登录入口后。SSS《Hello!》官方乐谱与词卡已导出为候选，歌曲网页仅提供播放入口。尝试读取官方 YouTube 视频时返回“video is not available”，未取得音视频文件或做实际媒体内容核验，故未上架儿歌媒体。
