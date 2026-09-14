# 网站与小程序发布包

## 最小数据关系

```text
Book → Unit → Lesson → Page → ContentBlock → Sentence/Word
                                  │              │
                                  └─ Question    └─ AudioSegment
                                         │
                                         └─ QuestionAudioMapping
```

## 点读片段

```json
{
  "id": "sentence-001",
  "text": "You are a great nurse.",
  "hitAreas": [{ "x": 0.135, "y": 0.208, "width": 0.205, "height": 0.027 }],
  "audioId": "audio-sentence-001",
  "startMs": 0,
  "endMs": 2180
}
```

## 听力题对位

```json
{
  "questionId": "question-unit1-001",
  "mediaVersionId": "media-unit1-v1",
  "mainSegment": { "startMs": 18200, "endMs": 26400 },
  "supplementSegments": [],
  "reviewStatus": "manually_reviewed"
}
```

生产导入时应复制资源版本快照；之后源资源更新或下架，不得改变历史任务。

## 微信导入约束

- 原始 PDF、WAV 母版、全量页面和音视频不进入微信小程序代码包。
- 派生页面图、MP3/AAC 和 MP4 上传 CloudBase 云存储或已配置 HTTPS CDN。
- `exports/wechat/asset-index.json` 是上传清单；上传后将 `deliveryUrl` 回填为 HTTPS 地址。
- 小程序业务数据只保存 `resourceId + version + assetKey/deliveryUrl`，不保存 `F:\`、`D:\` 等本机路径。
- 已发布任务固化资源版本和片段边界；新版本上传后不能改变历史任务。
- 远程服务需支持稳定 HTTPS 访问；音视频应支持断点或 Range 播放，域名配置到小程序合法域名清单。
