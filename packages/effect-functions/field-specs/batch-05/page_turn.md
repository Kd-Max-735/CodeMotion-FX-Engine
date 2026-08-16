# 翻页转场 `page_turn`

在服务端绑定的前后两路视频之间生成带卷曲、透视和投影的纸页翻转。它是页片网格变形，不是普通擦除或缩放转场。

调用时只输出一个 JSON 对象，不要输出解释、Markdown、代码围栏或任何资源信息。`type` 必须精确为 `page_turn`。

```json
{"type":"page_turn","data":{"direction":"left","duration":1,"curlRadius":0.35,"perspective":0.6,"shadowStrength":0.45,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `direction` | 否 | `left` / `right`，默认 `left` | 按页面翻向选择 |
| `duration` | 否 | `0.2..5` 秒，默认 `1` | 越小越快 |
| `curlRadius` | 否 | `0.05..1`，默认 `0.35` | 小值折痕锐利，大值卷曲柔和 |
| `perspective` | 否 | `0..1`，默认 `0.6` | 控制空间纵深，不代表角度 |
| `shadowStrength` | 否 | `0..1`，默认 `0.45` | 控制页背阴影强度 |
| `easing` | 否 | `linear` / `ease_in` / `ease_out` / `ease_in_out` | 未指定时用 `ease_in_out` |

## 参数选择方法与优先级

- 方向词先映射 `direction`；速度词只改 `duration` 和必要时的 `easing`。
- “尖锐折页”降低 `curlRadius`；“柔软、缓卷”提高 `curlRadius` 并可降低 `shadowStrength`。
- 用户给角度时，不直接虚构角度字段；用 `perspective` 表达空间感，真实翻转角由进度计算。
- 距离表达不适用于本工具；若用户说“更近、更有纵深”，优先提高 `perspective`。
- 冲突时按“明确数值 > 明确方向 > 速度 > 柔和度 > 风格词”处理；`curlRadius` 负责卷曲，`duration` 不替代柔和度。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 向左快速翻页 | `{"direction":"left","duration":0.55,"curlRadius":0.25,"perspective":0.6,"shadowStrength":0.5,"easing":"ease_out"}` |
| 向右柔和地翻过去 | `{"direction":"right","duration":1.5,"curlRadius":0.6,"perspective":0.45,"shadowStrength":0.3,"easing":"ease_in_out"}` |
| 做一个折痕明显的翻页 | `{"direction":"left","duration":1,"curlRadius":0.12,"perspective":0.7,"shadowStrength":0.65,"easing":"ease_in_out"}` |
| 慢速、有强烈纵深 | `{"direction":"left","duration":2.2,"curlRadius":0.3,"perspective":0.95,"shadowStrength":0.7,"easing":"ease_in"}` |
| 影子淡一点 | `{"direction":"left","duration":1,"curlRadius":0.35,"perspective":0.6,"shadowStrength":0.15,"easing":"ease_in_out"}` |
| 使用默认翻页 | `{"direction":"left","duration":1,"curlRadius":0.35,"perspective":0.6,"shadowStrength":0.45,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐自然翻页：`duration=0.8..1.4`、`curlRadius=0.25..0.55`、`perspective=0.45..0.75`。中性值为 `direction=left`、`curlRadius=0.5`、`perspective=0.5`、`shadowStrength=0.5`；完整默认值见合法示例。极小 `curlRadius` 和极高阴影只用于硬折、戏剧化表达。

两路视频由服务端绑定。模型不选择视频、遮罩或路径。当前产品若只上传静态图片，必须先由服务器静态帧源适配生成两路独立的视频帧源；不得把 `image` 直接绑定为 `video`，也不得复用同一绑定冒充前后两路。本工具不适用于传送门、镜头推进、物体对位剪辑、真实书本物理模拟或多页连续动画。
