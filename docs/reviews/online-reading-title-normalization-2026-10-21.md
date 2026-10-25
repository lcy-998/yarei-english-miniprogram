# 线上阅读素材标题规范化（2026-10-21）

## 执行范围

在既有非生产 CloudBase（cloud1-d8ggzrwwedb786e41）中，将 21 本已发布阅读素材的标题同步到其 21 个全教师目录投影，共更新 42 条学习资源文档。覆盖 Storybooks Canada 绘本、海尼曼 GK 绘本及人教版三年级下册、五年级上册、六年级上册。其他已标准化的教材标题保持原样。

只修改展示标题、并发版本/更新时间、来源指纹及投影来源版本；内容版本、正文、页图、媒体、状态、可见范围和历史任务快照未改。42 条学习资源各有对应操作审计。

## 标题读回

| 素材 ID | 修改前 | 修改后 |
| --- | --- | --- |
| book-04f1c315af39 | 48 At School  | 海尼曼 GK 绘本《At School》 |
| book-2324d4e33aa2 | 22 The Baby  | 海尼曼 GK 绘本《The Baby》 |
| book-2936d001b060 | 47 Fun At School  | 海尼曼 GK 绘本《Fun at School》 |
| book-47c3a29d9223 | sbc-en-0111-why-hippos-have-no-hair | Storybooks Canada 绘本《Why Hippos Have No Hair》（动物故事） |
| book-47d8344d39b1 | 14 On The Way To School  | 海尼曼 GK 绘本《On the Way to School》 |
| book-74899b89e8b8 | 1 At The Market  | 海尼曼 GK 绘本《At the Market》 |
| book-8841c1689c78 | sbc-en-0296-tom-the-banana-seller | Storybooks Canada 绘本《Tom the Banana Seller》（工作与市场） |
| book-973b4f5d78bc | sbc-en-0156-the-hungry-crocodile | Storybooks Canada 绘本《The Hungry Crocodile》（动物与动作） |
| book-97d134956f31 | sbc-en-0110-a-tiny-seed-wangari-maathai | Storybooks Canada 绘本《A Tiny Seed: The Story of Wangari Maathai》（人物传记与环境保护） |
| book-9b3e18882326 | sbc-en-0327-counting-animals | Storybooks Canada 绘本《Counting Animals》（动物与数字） |
| book-c59bdd641b51 | sbc-en-0087-i-like-to-read | Storybooks Canada 绘本《I Like to Read!》（阅读与家庭） |
| book-dcf25517aea8 | sbc-en-0095-zama-is-great | Storybooks Canada 绘本《Zama Is Great!》（家庭与自信） |
| book-f47b586ff90e | 28 Packing My Bag  | 海尼曼 GK 绘本《Packing My Bag》 |
| book-fede301c12da | sbc-en-0089-khalai-talks-to-plants | Storybooks Canada 绘本《Khalai Talks to Plants》（植物与自然） |
| book-ffc42d637d97 | pep-3b-current-2022 | 人教版英语三年级下册 |
| book-pep-5a-current-2024 | 人教版PEP英语五年级上册（新版） | 人教版英语五年级上册 |
| book-pep-6a-current-2024 | 人教版PEP英语六年级上册（新版） | 人教版英语六年级上册 |
| book-sbc-en-0001 | A very tall man | Storybooks Canada 绘本《A Very Tall Man》（想象与日常生活） |
| book-sbc-en-0004 | Goat, Dog, and Cow | Storybooks Canada 绘本《Goat, Dog, and Cow》（友谊与诚实） |
| book-sbc-en-0141 | Chicken and Millipede | Storybooks Canada 绘本《Chicken and Millipede》（友谊与竞争） |
| res_formal_sbc0008_v1_20261007 | What are you doing? | Storybooks Canada 绘本《What Are You Doing?》（日常动作） |

## 验证与回退

- 写入前确认现有非生产环境、两个虚构组织、超额计费关闭；数据库写配额读数为 337，写后读数为 777。
- 21/21 本书来源、21/21 跨组织投影、42/42 操作审计逐条读回通过。
- 两个虚构组织的教师布置目录和学生阅读目录均读回 25/25 个标题。
- 写前备份：workspace/m3-acceptance/2026-10-21/online-title-normalization/cloudbase-preimage.json。回退时以新文档版本恢复旧标题并新增审计，不回退并发版本号。
- 生产环境与小程序版本未修改。