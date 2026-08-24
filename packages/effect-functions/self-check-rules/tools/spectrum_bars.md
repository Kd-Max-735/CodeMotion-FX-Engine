# 频谱柱自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `barCount` | 频谱柱数量 |
| `gain` | 频谱增益 |
| `smoothing` | 频谱平滑度 |
| `falloff` | 回落速度 |
| `logarithmic` | 对数分布 |
| `barColor` | 频谱柱颜色 |
| `backgroundColor` | 背景颜色 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入为四字段自检 JSON 与最终 MP4 的 `keyframe_contact_sheet`。JSON 中只保留成片可观察事实、媒体质量和关键帧索引。

## 核心原则

必须在成片中实际看见多柱分布和随时间变化的柱高。不能用频域分析输入、柱数设置或执行完成证明频谱已经正确呈现。

## 自检视图字段

- `visible_bar_groups`：成片画面中可区分的柱组数量。
- `height_range`：柱高变化的可见等级。
- `temporal_variation`：柱形是否随时间变化。
- `frequency_layout`：实际柱形的横向分布状态。
- `metadata.media`、`metadata.quality`、`metadata.keyframe_evidence`：视频与证据事实。

## 关键帧规则

选择实际低柱态、高柱态和有代表性的频段分布态；若出现多个峰值，可增加关键帧。所有画面取自最终 MP4，按时间合成一张图。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 柱更多或更密 | `visible_bar_groups` 与宽幅关键帧 |
| 跳动明显 | `height_range` 与低、高柱态 |
| 平稳 | 跨时刻柱高变化不过度跳变 |
| 突出频段 | `frequency_layout` 与代表性分布态 |

## 判定流程

先确认柱形完整可见，再比较不同时刻的实际柱高与分布，最后检查用户要求和画面质量。静止占位柱不能通过音频响应要求。

## 通过与返修

通过要求多柱结构明确、柱高有实际时间变化且画面无断柱。返修说明“柱形缺失”“柱高近似静止”或“响应幅度不足”。

## 禁止事项

- 不输出频谱数组、频段数据、内部数量设置或映射方法。
- 不用音频输入变化替代柱形视觉变化。
- 不暴露后端、资源、路径或公式。
