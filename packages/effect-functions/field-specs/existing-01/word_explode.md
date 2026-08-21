# 文字爆散 `word_explode`

让服务端绑定的文字按词或字符向外爆散、旋转并随深度参数淡出。对应现有特效 `fx.text.wordExplode`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "word_explode",
  "data": {
    "force": 0.45,
    "rotation": 35,
    "depth": 0.3,
    "selector": "word",
    "text": "文字爆散",
    "fontFamily": "song",
    "fontSize": 72,
    "positionX": 0.5,
    "positionY": 0.5,
    "color": "#ffffff"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `force` | 是 | 数字 `0..4`，步长 `0.01`，默认 `0.45` | 控制爆散位移强度 |
| `rotation` | 是 | 数字 `-720..720` 度，步长 `1`，默认 `35` | 控制碎片旋转；正负值产生相反旋向 |
| `depth` | 是 | 数字 `0..2`，步长 `0.01`，默认 `0.3` | 控制随进度降低透明度的程度，不是三维 Z 坐标 |
| `selector` | 是 | `character` / `word`，默认 `word` | 整词成组爆散选 `word`，细碎效果选 `character` |
| `text` | 是 | 1–80 个字符 | 原样使用用户要求爆散的文字 |
| `fontFamily` | 是 | `song` / `kai` / `sans` | 选择真实印刷字形 |
| `fontSize` | 是 | `12..240` px | 控制文字大小 |
| `positionX` | 是 | `0..1` | 根据授权图片视觉理解得到文字中心横坐标 |
| `positionY` | 是 | `0..1` | 根据授权图片视觉理解得到文字中心纵坐标 |
| `color` | 是 | `#RRGGBB` | 用户指定颜色优先 |

## 参数选择优先级

先用 `selector` 选粒度，再用 `force` 定爆散距离、`rotation` 定旋转、`depth` 定淡出。用户只要求“散开”时不要同时给出极大旋转和深度。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 词语轻轻散开 | `force=0.2, rotation=10, depth=0.15, selector=word` |
| 每个字符明显爆开 | `force=0.8, rotation=90, depth=0.45, selector=character` |
| 整词向外飞散但不旋转 | `force=0.6, rotation=0, depth=0.25, selector=word` |
| 字符反向旋转爆散 | `force=0.7, rotation=-120, depth=0.4, selector=character` |
| 强烈文字爆炸并淡出 | `force=1.4, rotation=240, depth=0.9, selector=word` |

`force` 推荐值：轻微 `0.2`，中等 `0.45`，明显 `0.8`，强烈 `1.4`。`rotation` 推荐绝对值：轻微 `10°`，中等 `35°`，明显 `90°`，强烈 `240°`。默认按词中等爆散；`force=0, rotation=0, depth=0` 是中性设置。

模型必须从自然语言提取文字，并根据随请求提供的授权图片定位文字中心。`force` 独立控制四散距离，不能用视频时长代替剧烈程度。服务器生成真实字形透明层。本工具不生成粒子、碎片网格、真实三维深度、声音或物理碰撞，也不要输出素材或资源字段。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：作为视频背景，并仅用于允许的视觉定位。服务器按 Tool Call 中的文字样式生成透明真实字形并叠加到该背景；资源身份不进入模型参数。
