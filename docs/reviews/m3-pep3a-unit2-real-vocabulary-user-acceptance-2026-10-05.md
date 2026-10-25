# 人教版三年级 Unit 2 真实词包非生产开放记录（2026-10-05）

## 结果

按 M3 0.66.0 的“待用户验收”口径，将 F 盘英语资产库中可追溯的人教版三年级 Unit 2 词包开放到既有非生产 CloudBase 三年级 2 班。资源标题标明“真实来源·待用户验收”，不是人工内容审批通过；没有发布课堂任务、部署函数或修改旧资源。

- 资源：`res_m3_pep3a_u2_real_vocabulary_20261005`
- 审计：`audit_m3_pep3a_u2_real_vocabulary_20261005`
- 可见范围：仅 `cls_grade3_2`，36 名有效虚构学生。四年级 1 班不授权。
- 词条：`grandma`、`grandpa`、`family`；词义来自原词表页，例句 `This is my grandma.`、`This is my grandpa.`、`Look! This is my family.` 来自课本第 17 页。音节分别为 `grand-ma`、`grand-pa`、`fam-i-ly`。
- 资产状态：CloudBase 记录 `status=published` 以供受限测试目录读取，并同时保存 `acceptanceStatus=pending_user_acceptance`、`testOnly=true`、未核准字段和来源哈希；本地资产库候选仍保持 `needs_review`。

## 来源与上传

资产源自 `F:\英语资产`：三年级上册原书 `book-unknown-3a` 的第 83 页词表及同单元官方词音。资源处理前复核了以下本地 SHA-256：

| 文件 | SHA-256 | 字节 |
| --- | --- | ---: |
| `library/books/book-unknown-3a/v1/pages/page-0083.jpg` | `e3733ec0a99d6dc6effe62740c9f25c51a66a9430379429a236970f69a92cb04` | 390,287 |
| `inbox/pep-3s-official/149_Words in each unit Unit 2.mp3` | `3a3ca484baf84180b00c736a70dc9dc180b3fb6ce1a5e0b5c0d1b6ce5ec7449b` | 1,393,937 |
| `library/derived/m3-pep3a-unit2-vocabulary/v1/word-pack-source-v1.json` | `3255018d0a80b553b6e4a3c5bfb6238aa3aa29077889ad06c064dedeefc8709d` | 2,418 |
| `library/derived/m3-pep3a-unit2-vocabulary/v1/source-provenance-v1.json` | `9690333141c31dc98ef8f2761902930dab998bb768337753d939f120baedd897` | 1,121 |

4 个源证据文件共 1,787,763 字节上传到私有云存储。上传后独立下载核对 SHA-256 为 **4/4 匹配**。CloudBase 仅向三年级 2 班开放这条词包记录；没有公开存储文件。

## 验证

- F 盘资产库标准增量流水线：新增处理 0、未变化跳过 1,353、失败 0。
- 云端预检确认环境与授权范围匹配、班级成员 36 人、资源及审计 ID 为空；月度费用读数为 0。
- 独立云端读回：资源和审计 2/2、私有文件哈希 4/4。
- 业务读取验证：三年级学生词包目录、学生内容目录和教师任务资源目录均可读取；四年级学生目录无法看到该词包。
- 没有新增函数部署或课程任务。微信开发者工具里已登录教师/学生的界面点击、学生作答提交和教师点评本次没有执行，不将服务端目录验证说成完整作业闭环验收。

## 保留的未核字段

- 原 PDF 版次/教材元数据尚未确认，资源如实标注“版次待核”。
- 第 2 单元整段词音已作为私有来源证据保存；逐词 `startMs/endMs` 仍为空，未伪造逐词对位。该录音不作为本词包的逐词播放器映射。
- 这份资源面向三年级，故没有给四年级班级授权。

执行脚本：`workspace/m1-cloudbase/tools/run-m3-real-vocabulary-acceptance.mjs`；机器回执：`workspace/m3-real-samples/2026-10-05-vocabulary/cloud-import-manifest.json`。
