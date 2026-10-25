# 五类指定素材自行导出与上架记录（2026-10-17）

## 范围与结论

用户已在本任务确认五类指定素材的使用权限，并要求 Codex 自行导出、审核后上架。本次在已有《阅读探索者》全球版样章五题组之外，新增 **Phonics Monster 1 第三版官方预览 Unit 1** 的一年级五题习题组。题组 ID 为 `exercise_pack_pm1_3rd_unit1_preview_20261016_v2`，五题作为一个教师可选任务项。该内容明确标注“第三版官方预览”，不代表整册课程已上架。

另从 Super Simple Songs 官方站导出《Hello!》乐谱与六张情绪词卡，保留 `needs_review` 候选。环球少年英语、新时空英语、中国版阅读探索者和完整 SSS 歌曲仍缺可核验、可供学生完成任务的源文件或音视频；未将全球版或在线播放页冒充对应国内教材或歌曲媒体。

## Phonics Monster 1 来源及内容审核

- 来源：A*List [Student Book 1 (3rd)](https://www.alist.co.kr/books/view.asp?bcode=06PM3E01SB) 的[官方公开预览](https://www.alist.co.kr/books_files/preview/06PM3E01SB/)，共 20 页，元数据标明 2025 年第三版；原页存放于 `G:\英语资产\inbox\phonics-monster-1-3rd-official-preview-2026-10-16\`。第 12–19 预览页对应印刷第 10–17 页，覆盖 Unit 1 Aa Bb Cc 的字母、单词与故事。逐页来源 URL、SHA-256、字节数在 G 盘 v2 包的 `source-records/pm1-unit1-source-record.json`。
- 使用权依据：用户在本任务的确认，按具体官方预览资源和小程序教学分发用途关联记录；无虚构合同号。课程媒体下载入口要求 A*List 登录，故本次题组不包含原书音视频。
- 内容：根据官方预览自编五道互不重复的基础单选，依次核对大小写 A、B 起始词、C 起始词组、`book` 词义、故事中的 `alligator`。题干和选项包含作答所需信息，学生不依赖后台来源页。答案、解析、印刷页码及学生无答案预览分别保存在 G 盘 v2 内容包和 Codex 审核记录。
- 版本包：`G:\英语资产\library\derived\phonics-monster-1-3rd-unit1-preview-exercises-20261016\v2\`；五份 CloudBase 导出位于 `G:\英语资产\exports\wechat\phonics-monster-1-3rd-unit1-preview-20261016-v2\`。素材流水线发现并核验五题，结果 `processed=5, skipped=2876, failed=0`，本地目录五题均为 `publish_ready`。

## 发布与读回

- 内容通道：唯一已核对 CloudBase 环境 `cloud1-d8ggzrwwedb786e41`，个人版，超量计费关闭；发布前 `DbWritepkg=82`、`DbReadpkg=2098`、`FunctionInvocation=2109`。临时凭据仅在进程内使用。
- 发布前核验五份导出哈希、来源、审核、权限、题组 ID、目标空位、两所测试组织及软下架回退点；只写教学内容。没有部署云函数、变更基础设施、真实账号权限或小程序版本。
- 发布五条公共来源、五条跨组织投影、十条操作审计。独立 `verify` 读回 10/10 内容、10/10 审计；两组织教师题库各见完整五题，摘要不含答案与解析。当前云端五类审计扫描 527 条资源：阅读探索者 10 条发布态记录（一组五题的来源与投影）、Phonics Monster 1 10 条发布态记录；另三类为零。阅读探索者旧英文标题组 10 条记录已保留为软下架历史。
- G 盘流水线单元测试 34/34 通过；复用的题组页面合约检查 `teacher-exercise-pack-selection.test.ts` 通过 1/1。本次误以 `npm test -- --run ...` 执行了全量测试，333 个文件中 332 通过，2 个失败均在并行开发中的教师私有视频 `SERVICE_UNAVAILABLE`，与本内容包无关；未将全量检查记为通过。尚无真实微信账号或真机页面验收。

## 其他来源与缺口

- 环球少年英语、新时空英语、国内版阅读探索者：圣智中国[产品页](https://www.nglearning.cn/ow.html)、[新时空页](https://www.nglearning.cn/timezones/)、[阅读探索者页](https://www.nglearning.cn/readingexplorer/)均将样章和更多资源交由学术代表提供。公开网页没有相应国内版学生用书与完整配套媒体的可直接导出文件；G 盘库内也未检出。已有 Reading Explorer 3e **全球版**样章题组单独标注，不充当中国版。
- Phonics Monster 1：第三版公开预览的 Unit 1 可作上述自编题依据；整册 104 页和出版社 MP3、词表等素材在登录入口后，当前没有可用会话或完整导出，因此未把预览冒称整册拼读课程。
- SSS 儿歌：Super Simple Songs [《Hello!》歌曲页](https://supersimple.com/song/hello/)提供歌词与在线视频，并提供[官方乐谱](https://supersimple.com/downloads/sheet-music/hello-sheet-music-d-orig.pdf)和[六张词卡](https://supersimple.com/downloads/hello-flashcards.pdf)。本地路径 `G:\英语资产\inbox\sss-hello-official-printables-2026-10-17\`，乐谱 3 页，SHA-256 `e34a061d36918d80f9ee83cdee14574f9dd6c9e9f7af6450fefcdc41c245e07c`；词卡 6 页，SHA-256 `356065784534a74ef9eac989117e56e6996a6c559825534773202e49c2285c86`。流水线 `processed=2, skipped=2881, failed=0`，两份为 `needs_review`。未取得可私有上传并作实际音频内容核对的歌曲媒体，故未发布为儿歌任务。

## 后续补齐条件

取得三套国内教材的出版社导出包或可用学术代表下载入口、Phonics Monster 1 完整教师/学生资源访问会话，以及 SSS 可分发的音视频母版后，按现有资产规范逐项核对版次、完整性、媒体内容、学生可完成性，再以新版本发布。此处记录技术来源缺口，不重新要求用户确认已给出的使用权限。
