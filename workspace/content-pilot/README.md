# 英语教材资产试加工

本目录用于验证“PDF → 页面图 → 文字坐标 → 人工复核点读区 → 演示音频 → 结构化单词”的加工链路，不属于 M0 小程序运行包，也不表示相关教材已获得发布授权。

## 已有结果

- `inventory.json`：7 本 PDF 的文字层覆盖情况和逐页提取摘要。
- `sample-four-upper-unit-1/`：四年级上册 Unit 1 样板。
  - `page-013.png`：PDF 第 13 页（书内第 9 页）高清页面。
  - `page-013.words.json`：自动提取的单词与归一化坐标。
  - `manifest.json`：经人工复核的 9 个句子点读区。
  - `unit-1-vocabulary.json`：Unit 1 的 19 个首轮人工整理词条。
  - `audio/`：本机语音引擎生成的 WAV 演示发音，仅用于可行性验证。
  - `viewer.html`：浏览器中打开即可点击句子试听。
  - `page-013-zones.jpg`：点读热区检查图。

## 重新生成

使用 Codex 工作区提供的 Python 环境运行 `workspace/tools/asset-pipeline/` 中的脚本。源 PDF 始终只读，所有生成结果写入本目录。

生产接入前必须替换演示音频、确认版权授权、完成双人内容复核，并按产品里程碑在 M3/M4 接入，而不是提前进入 M0 小程序包。
