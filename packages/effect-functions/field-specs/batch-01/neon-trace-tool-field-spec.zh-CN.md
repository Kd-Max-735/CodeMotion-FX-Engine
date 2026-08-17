# 霓虹路径追踪 `neon_trace`

沿服务端绑定路径截取发光尾迹，并在线性色彩空间生成核心亮线和多尺度光晕。只输出 JSON，不要附加解释、Markdown 或代码块：

```json
{"type":"neon_trace","data":{"progress":1,"glowRadius":18,"intensity":2,"trailLength":0.25,"pulseRate":1.2,"hue":190,"coreWidth":2.5}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `progress` | 否 | `0..1`，默认 `1` | 路径头部的目标位置；视频前 1.4 秒自动追踪到该位置 |
| `glowRadius` | 否 | `0..200` px，默认 `18` | 外围光晕半径 |
| `intensity` | 否 | `0..10`，默认 `2` | 线性光强，可超过 1 |
| `trailLength` | 否 | `0.01..1`，默认 `0.25` | 发光尾迹占总路径比例 |
| `pulseRate` | 否 | `0..12` Hz，默认 `1.2` | 明暗脉冲频率；`0` 为稳定 |
| `hue` | 否 | `0..360` 度，默认 `190` | 霓虹色相 |
| `coreWidth` | 否 | `0.5..40` px，默认 `2.5` | 中心高亮线宽度 |

## 参数选择规则

1. “走到哪里”用 `progress`，“尾巴多长”用 `trailLength`，两者含义不可互换；服务器会让追踪头在前 1.4 秒抵达目标位置。
2. 先调 `intensity` 再调 `glowRadius`；前者决定亮度，后者决定扩散范围。
3. 稳定招牌设 `pulseRate=0`，跳动灯光再提高频率。颜色按用户明确色相或常见颜色选择。

| 自然语言 | 参数对应 |
| --- | --- |
| 稳定的青色细霓虹 | `hue=185, coreWidth=2, intensity=1.5, pulseRate=0` |
| 只追踪到路径六成 | `progress=0.6` |
| 像彗星一样短尾快速闪烁 | `trailLength=0.1, pulseRate=3, intensity=3` |
| 整条路径持续发光 | `progress=1, trailLength=1, pulseRate=0` |
| 紫色宽光晕 | `hue=285, glowRadius=42, coreWidth=3.5` |
| 微弱呼吸灯 | `intensity=0.8, pulseRate=0.5, glowRadius=10` |

| 程度 | `intensity` | `glowRadius` |
| --- | ---: | ---: |
| 轻微 | `0.7` | `6` |
| 中等 | `2` | `18` |
| 明显 | `4` | `36` |
| 强烈 | `7` | `70` |

默认值为示例中的完整 `data`。中性关闭值是 `intensity=0`；`glowRadius=0` 只关闭外围光晕，仍保留核心亮线。稳定动画值是 `pulseRate=0`。不适用于真实灯具照明、文字内容生成、闪电分支或无路径的全屏泛光。路径由服务端绑定，模型只生成上述数值。
