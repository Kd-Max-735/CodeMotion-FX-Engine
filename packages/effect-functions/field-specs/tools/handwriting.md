# 手写笔迹 `handwriting`

在一张已授权图片上按服务端字体栅格逐步显现手写内容，并调节笔压和书写速度变化。对应现有特效 `fx.draw.handwriting`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "handwriting",
  "data": {
    "text": "手写文字",
    "fontFamily": "kai",
    "fontSize": 72,
    "positionX": 0.5,
    "positionY": 0.5,
    "color": "#202020",
    "pressure": 0.7,
    "speedVariation": 0.25,
    "progress": 0.5
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `text` | 是 | 1-80 个字符 | 用户要求手写的确切内容；保留换行 |
| `fontFamily` | 是 | `song` / `kai` / `sans` | 楷书优先用于手写感，宋体用于印刷感 |
| `fontSize` | 是 | 整数 `12..240` | 文字大小，按画布像素选择 |
| `positionX` | 是 | 数字 `0..1` | 文字中心横向位置 |
| `positionY` | 是 | 数字 `0..1` | 文字中心纵向位置 |
| `color` | 是 | `#RRGGBB` | 笔迹颜色 |
| `pressure` | 是 | 数字 `0..1`，步长 `0.01` | 越大笔迹越厚、笔压感越强 |
| `speedVariation` | 是 | 数字 `0..1`，步长 `0.01` | 越大书写前沿的快慢变化越明显 |
| `progress` | 是 | 数字 `0..1`，步长 `0.01` | `0` 未写，`1` 完成；按用户要求的完成比例选择 |

## 参数选择规则

- “细笔、轻写”优先降低 `pressure`；“粗重、有力”优先提高 `pressure`。
- “匀速、机械”降低 `speedVariation`；“自然、随性、顿挫”提高它。
- “刚开始/写一半/快写完”分别映射为较小值、`0.5`、接近 `1` 的 `progress`。
- 强弱主要由 `pressure` 决定，节奏变化主要由 `speedVariation` 决定，不要用二者重复表达完成度。
- 用户未描述书写阶段时使用默认 `progress=0.5`，不根据持续时间自行推算。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 轻轻写到一半，速度保持均匀 | `{"pressure":0.35,"speedVariation":0.05,"progress":0.5}` |
| 笔迹粗一些，刚写了四分之一 | `{"pressure":0.85,"speedVariation":0.25,"progress":0.25}` |
| 自然手写，快慢变化明显，快完成了 | `{"pressure":0.7,"speedVariation":0.65,"progress":0.9}` |
| 很细的机械式描写，全部写完 | `{"pressure":0.2,"speedVariation":0,"progress":1}` |
| 保持默认笔感，只显示开头 | `{"pressure":0.7,"speedVariation":0.25,"progress":0.1}` |

## 推荐档位

| 程度 | `pressure` | `speedVariation` | `progress` |
| --- | ---: | ---: | ---: |
| 轻/稳定/起笔 | `0.25` | `0.05` | `0.1` |
| 中等/自然/半程 | `0.7` | `0.25` | `0.5` |
| 重/强变化/近完成 | `0.9` | `0.7` | `0.9` |

默认值为 `pressure=0.7`、`speedVariation=0.25`、`progress=0.5`。中性书写采用默认值；`pressure=0`、`speedVariation=0` 和 `progress=0` 分别是无笔压扩张、完全匀速和未显现的边界，三个字段的 `1` 是各自最大值。极端值只在用户明确要求时使用。

文字内容、字体栅格和书写路径由服务端根据上述参数生成，不生成资源 ID、路径或 URL。本工具不用于笔刷纹理显现、墨水扩散或粉笔颗粒。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：承载手写内容的用户图片。图片身份不进入模型参数，缺失时必须停止执行。
