# 物体匹配剪辑 `object_match_cut`

利用服务端绑定的前后两路视频及两份物体遮罩，对齐同一主体的尺度和旋转后完成剪辑。模型只描述过渡节奏和补偿强度，不选择主体或遮罩。

只输出 JSON，不输出解释或资源。`type` 必须精确为 `object_match_cut`。

```json
{"type":"object_match_cut","data":{"duration":1,"cutPoint":0.5,"blendWindow":0.18,"alignmentStrength":0.8,"scaleCompensation":0.12,"rotationCompensation":0,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
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
- 模型不得根据文字猜测主体坐标、遮罩或 camera target，它们由服务端授权绑定。
- 冲突时按“明确切点 > 明确角度/尺度 > 对齐强度 > 速度 > 柔和度”处理；`blendWindow` 不能代替 `duration`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 在中点快速精准匹配 | `{"duration":0.7,"cutPoint":0.5,"blendWindow":0.08,"alignmentStrength":1,"scaleCompensation":0.1,"rotationCompensation":0,"easing":"ease_out"}` |
| 晚一点柔和切换 | `{"duration":1.5,"cutPoint":0.7,"blendWindow":0.5,"alignmentStrength":0.7,"scaleCompensation":0.12,"rotationCompensation":0,"easing":"ease_in_out"}` |
| 旋转校正 12 度 | `{"duration":1,"cutPoint":0.5,"blendWindow":0.18,"alignmentStrength":0.85,"scaleCompensation":0.1,"rotationCompensation":12,"easing":"ease_in_out"}` |
| 主体尺寸差很大 | `{"duration":1.2,"cutPoint":0.5,"blendWindow":0.25,"alignmentStrength":0.9,"scaleCompensation":0.4,"rotationCompensation":0,"easing":"ease_in_out"}` |
| 几乎硬切但保持对位 | `{"duration":0.5,"cutPoint":0.5,"blendWindow":0.04,"alignmentStrength":1,"scaleCompensation":0.08,"rotationCompensation":0,"easing":"linear"}` |
| 使用默认匹配剪辑 | `{"duration":1,"cutPoint":0.5,"blendWindow":0.18,"alignmentStrength":0.8,"scaleCompensation":0.12,"rotationCompensation":0,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐 `cutPoint=0.4..0.6`、`blendWindow=0.08..0.35`、`alignmentStrength=0.75..1`。中性值为 `cutPoint=0.5`、`rotationCompensation=0`、`scaleCompensation=0`；完整默认值见示例。

视频与两份匹配遮罩由服务端绑定。模型不输出资源 ID、路径、URL 或主体选择。当前产品若只上传静态图片，必须先由服务器静态帧源适配生成两路独立的视频帧源；不得把 `image` 直接绑定为 `video`，不得复用同一视频绑定，也不得复用同一遮罩绑定。静态帧适配不能生成或冒充匹配遮罩。本工具不适用于无可匹配主体的素材、语义检测、镜头跟踪、传送门、翻页或多物体组合剪辑。
