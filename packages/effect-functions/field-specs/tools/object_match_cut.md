# 物体匹配剪辑 `object_match_cut`

利用服务端绑定的前后两路画面及两份 SAM3.1 物体遮罩，对齐同一主体的位置、尺度和旋转后完成剪辑。模型查看第一张图片，并把用户指定的视觉锚点转换为简短英文 `target`；服务器用同一 `target` 分别分割两张图，模型不输出遮罩或坐标。

只输出 JSON，不输出解释或资源。`type` 必须精确为 `object_match_cut`。

```json
{"type":"object_match_cut","data":{"target":"main subject","duration":1,"cutPoint":0.5,"blendWindow":0.18,"alignmentStrength":0.8,"scaleCompensation":0.12,"rotationCompensation":0,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `target` | 否 | 1..80 个英文字符，默认 `main subject` | 结合第一张图和用户描述，输出两张图中应保持视觉连续的同一主体，如 `red ball`、`car`；不得输出坐标、中文或资源信息 |
| `duration` | 否 | `0.2..5` 秒，默认 `1` | 整体转场时长 |
| `cutPoint` | 否 | `0.1..0.9`，默认 `0.5` | 切点在时长中的比例 |
| `blendWindow` | 否 | `0.04..2` 秒，默认 `0.18` | 切点附近混合长度，不得超过时长的 80% |
| `alignmentStrength` | 否 | `0..1`，默认 `0.8` | 遮罩对位强度 |
| `scaleCompensation` | 否 | `0..0.5`，默认 `0.12` | 两主体尺寸差补偿 |
| `rotationCompensation` | 否 | `-45..45` 度，默认 `0` | 对位旋转角度 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 控制对位和混合节奏 |

## 参数选择方法与优先级

- “早切、晚切”调整 `cutPoint`；速度主要由 `duration`，切口柔和度由 `blendWindow`。
- 明确角度写入 `rotationCompensation`；主体大小差异用 `scaleCompensation`，距离词不适用。
- “精准对齐”提高 `alignmentStrength` 并缩短 `blendWindow`；“柔和融合”增大 `blendWindow`。
- 必须结合第一张图识别用户指定主体，将其写成可供 SAM3.1 在两张图中复用的英文名词短语；不要用 `object at left` 一类仅依赖第一张图位置的描述。
- 模型不得输出主体坐标、遮罩或 camera target，它们由服务端根据 `target` 派生。
- 冲突时按“明确切点 > 明确角度/尺度 > 对齐强度 > 速度 > 柔和度”处理；`blendWindow` 不能代替 `duration`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 让两张图中的红色圆球在中点快速精准匹配 | `{"target":"red ball","duration":0.7,"cutPoint":0.5,"blendWindow":0.08,"alignmentStrength":1,"scaleCompensation":0.1,"rotationCompensation":0,"easing":"ease_out"}` |
| 让汽车晚一点柔和切换 | `{"target":"car","duration":1.5,"cutPoint":0.7,"blendWindow":0.5,"alignmentStrength":0.7,"scaleCompensation":0.12,"rotationCompensation":0,"easing":"ease_in_out"}` |
| 对齐主体并旋转校正 12 度 | `{"target":"main subject","duration":1,"cutPoint":0.5,"blendWindow":0.18,"alignmentStrength":0.85,"scaleCompensation":0.1,"rotationCompensation":12,"easing":"ease_in_out"}` |
| 主体尺寸差很大 | `{"target":"main subject","duration":1.2,"cutPoint":0.5,"blendWindow":0.25,"alignmentStrength":0.9,"scaleCompensation":0.4,"rotationCompensation":0,"easing":"ease_in_out"}` |
| 几乎硬切但保持人物对位 | `{"target":"person","duration":0.5,"cutPoint":0.5,"blendWindow":0.04,"alignmentStrength":1,"scaleCompensation":0.08,"rotationCompensation":0,"easing":"linear"}` |
| 使用默认匹配剪辑 | `{"target":"main subject","duration":1,"cutPoint":0.5,"blendWindow":0.18,"alignmentStrength":0.8,"scaleCompensation":0.12,"rotationCompensation":0,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐 `cutPoint=0.4..0.6`、`blendWindow=0.08..0.35`、`alignmentStrength=0.75..1`。中性值为 `cutPoint=0.5`、`rotationCompensation=0`、`scaleCompensation=0`；完整默认值见示例。

用户只需提供前后两张独立图片；服务器静态帧源适配会生成两路受控帧源，并以同一个 `target` 调用 SAM3.1，从各自图片派生锁定的主体遮罩用于位置和尺度对位，不要求用户再上传两张遮罩，不得把 `image` 直接绑定为 `video`。模型不输出资源 ID、路径或 URL，资源身份不会进入参数。转场必须同时使用两张图片，并在切点附近完成主体位置、尺度、旋转和轮廓对齐，开始与结束必须保持原始画面。本工具不适用于两张图中没有同类可匹配主体、镜头跟踪、传送门、翻页或多物体组合剪辑。
