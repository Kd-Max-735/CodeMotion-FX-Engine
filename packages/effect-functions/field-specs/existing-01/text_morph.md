# 文字变形 `text_morph`

把自然语言指定的源文字平滑变形成目标文字。服务端分别生成两套真实印刷字形，按时间推进字形扰动、轮廓过渡、颜色渐变和位置适配；`progress` 可以让动画停留在任意目标阶段。对应现有特效 `fx.text.textMorph`。

只输出以下 JSON，不附加解释或代码块：

```json
{"type":"text_morph","data":{"sourceText":"CODE","targetText":"MOTION","matchMode":"glyph","progress":1,"duration":2.5,"fontFamily":"sans","fontSize":88,"sourcePositionX":0.5,"sourcePositionY":0.5,"targetPositionX":0.5,"targetPositionY":0.5,"sourceColor":"#5ac8fa","targetColor":"#ff5ea8"}}
```

| `data` 字段 | 必填 | 取值与默认值 | 选择策略 |
| --- | --- | --- | --- |
| `sourceText` | 是 | 非空字符串，最长 80，默认 `CODE` | 严格使用用户给出的变形前文字 |
| `targetText` | 是 | 非空字符串，最长 80，默认 `MOTION` | 严格使用用户给出的变形后文字 |
| `matchMode` | 是 | `glyph` / `outline` / `position`，默认 `glyph` | 按字符对应选 `glyph`；强调外轮廓连续变形选 `outline`；强调文字布局和位置对应选 `position` |
| `progress` | 是 | 数字 `0..1`，步长 `0.01`，默认 `1` | 动画最终停留阶段；`0` 为源文字，`1` 为完整目标文字 |
| `duration` | 是 | 数字 `0.2..30` 秒，步长 `0.1`，默认 `2.5` | 从源端运行到 `progress` 指定阶段所需时间 |
| `fontFamily` | 是 | `song` / `kai` / `sans`，默认 `sans` | 宋体选 `song`，楷书选 `kai`，现代无衬线选 `sans` |
| `fontSize` | 是 | 数字 `12..240`，整数，默认 `88` | 文字字号，服务端仍会确保字形位于画布内 |
| `sourcePositionX` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 源文字中心横坐标，左上原点 |
| `sourcePositionY` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 源文字中心纵坐标，左上原点 |
| `targetPositionX` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 目标文字中心横坐标，左上原点 |
| `targetPositionY` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 目标文字中心纵坐标，左上原点 |
| `sourceColor` | 是 | `#RRGGBB`，默认 `#5ac8fa` | 源文字颜色 |
| `targetColor` | 是 | `#RRGGBB`，默认 `#ff5ea8` | 目标文字颜色 |

## 参数选择规则

源文字和目标文字顺序不能颠倒。用户要求完整变形时使用 `progress=1`；要求停在中间态时按明确比例填写。`duration` 只控制到达该阶段的速度，不改变停留阶段。模型会同时收到本工具唯一授权查看的背景图片：用户只说明“在某处进行文字变形”时，必须通过图片视觉理解定位该区域中心，并把同一坐标写入源、目标两组位置；只有用户明确要求文字从一个位置移动到另一个位置时，才使用两组不同坐标并选择 `position`。不得仅凭固定方位模板猜测图中对象位置。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：用户上传、owner-authorized 且 locked 的背景图片。它既作为最终背景，也仅在本工具允许的 Ark 多模态请求中用于把自然语言位置转换为归一化坐标。服务端在该图片上叠加两套真实文字栅格；图片身份、字体文件和字形数据都不进入模型参数。

本工具不识别图片里的现有文字，不修改上传图片本身的 Logo 轮廓，也不生成字体、资源 ID、路径或 URL。
