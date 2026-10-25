# 英语视频配音逐句字幕素材批次（2026-10-22）

## 已实施

- G 盘生产准入新增师生展示标题规范：不得直接把文件名、slug、内部 ID 当标题；标题须能看出教材/主题、年级和素材用途。新增视频配音准入：逐句 cue 绑定视频哈希、VTT 与 JSON 双份交付，学生在视频下方看当前句；后端沿用冻结任务中的 `subtitleAssetKey` 和 `subtitleCues`。
- 语音原声素材优先；ASR 只作候选，NASA Space Place 的官方逐字稿用于原声转录，两个 ASR 模型交叉核对时间。四段无可辨英文对白的 Pexels 片段标为“自编配音脚本”，不冒称字幕提取，也不含示范配音音轨。
- 当前小程序已有字幕 cue 冻结与学生页按播放位置显示当前字幕的支持，本批次没有修改页面或服务代码。

## 素材

| 标题 | 时长 | cue 数 | 字幕来源 |
|---|---:|---:|---|
| 幼苗生长｜自然观察配音练习（三至四年级） | 12.9 秒 | 3 | 自编配音脚本，静音背景音轨 |
| 海龟漫游｜海洋动物配音练习（三至四年级） | 18 秒 | 3 | 自编配音脚本，原始音轨已移除 |
| 蝴蝶访花｜自然观察配音练习（三至四年级） | 15 秒 | 3 | 自编配音脚本，原始音轨已移除 |
| 猫咪追线团｜宠物配音练习（三至四年级） | 12.2 秒 | 3 | 自编配音脚本，原始音轨已移除 |
| NASA Kids Science｜温室效应入门配音片段（四至五年级） | 6.6 秒 | 2 | NASA 官方逐字稿 |
| 日全食来了｜NASA 太空动画逐句跟读（三至四年级） | 50.5 秒 | 11 | NASA Space Place 官方逐字稿 |

Pexels 视频来源：幼苗 [8522207](https://www.pexels.com/video/time-lapse-of-seedlings-8522207/)、海龟 [11342029](https://www.pexels.com/video/turtle-swimming-underwater-11342029/)、蝴蝶 [5129566](https://www.pexels.com/video/close-up-video-of-butterfly-on-a-flower-5129566/)、猫 [9834400](https://www.pexels.com/video/cat-playing-with-thread-9834400/)。均按 [Pexels License](https://www.pexels.com/license/) 记录来源、改编范围与署名边界。

NASA 来源：[温室效应视频和逐字稿](https://science.nasa.gov/kids/videos/video-what-is-the-greenhouse-effect/)、[日食视频和逐字稿](https://spaceplace.nasa.gov/eclipse-snap/en/)、[NASA 媒体使用规则](https://www.nasa.gov/nasa-brand-center/images-and-media/)。NASA 视频保留来源音轨并在标题/权利记录中注明 NASA；原声行按官方逐字稿保存，ASR 用于候选时间轴核对。

## 审核与上架记录

- G 盘素材流水线：6 条均为 `publish_ready`，逐句字幕与最终视频版本 SHA-256 绑定；MP4 为 H.264/AAC。源文件和输出经 ClamAV 1.5.4 扫描，EICAR 负控按预期检出。
- CloudBase：导入到现有非生产环境 `cloud1-d8ggzrwwedb786e41`；存储权限维持私有。每条上传 MP4、VTT、cue JSON 和权利记录各 1 份，共 24 个对象，逐个下载读回并匹配 SHA-256。6 个素材均读回为已发布 `dubbing` 资源，包含 2–11 条字幕 cue；源目录及两个虚构组织投影共 12 条记录已核对。
- 当前线上库已发布记录标题审计：565 条，匹配文件名/slug 风格标题 0 条；示例 `sbc-en-0111-why-hippos-hav-no-hair` 和 `pep-b-current-2022` 在当前已发布 `learning_resources` 中均未出现。因此没有对已发布旧标题进行猜测式改名。
- 当前配置没有生产素材环境。本次“上架”仅指现有非生产 CloudBase 目录，不代表生产环境发布。未执行微信提审或小程序版本发布。

## 留档位置

- 生产规范：`G:\英语资产\docs\PRODUCTION-CONTENT-GATE.md`
- 集成规范：`G:\英语资产\docs\WECHAT-INTEGRATION.md`
- 资产目录：`G:\英语资产\library\catalog.json`
- 本批次源视频、成片、VTT、cue JSON、权利记录、技术扫描与 CloudBase 读回收据均位于 `G:\英语资产\library\derived\` 下对应版本目录。
