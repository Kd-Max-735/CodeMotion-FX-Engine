# 音频波形自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `sampleCount` | 采样数量 |
| `gain` | 波形增益 |
| `smoothing` | 波形平滑度 |
| `thickness` | 线条粗细 |
| `horizontalScale` | 横向缩放 |
| `mirror` | 镜像显示 |
| `lineColor` | 波形颜色 |
| `backgroundColor` | 背景颜色 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入为 `file_name`、`original_request`、`summary`、`metadata` 自检 JSON，以及一张由最终 MP4 帧组成的 `keyframe_contact_sheet`。

## 核心原则

必须根据成片像素描述波形线数量、连续性、振幅范围和时间变化。音频采样存在或波形计算完成都不能替代最终画面证据。

## 自检视图字段

- `trace_count`：实际可见的主波形线数量。
- `vertical_extent_range`：实际振幅变化等级。
- `temporal_variation`：波形是否随时间变化。
- `continuity`：横向波形是否完整连续。
- 媒体、质量和关键帧信息位于 `metadata`。

## 关键帧规则

选择低振幅、高振幅和代表性形态变化帧；镜像波形要让上下两条线同时可见。数量由实际振幅阶段决定，按时间合成一张图。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 单线或上下镜像 | `trace_count` 与完整画面 |
| 振幅更大或轻微 | `vertical_extent_range` 与高低振幅态 |
| 跟随音频变化 | `temporal_variation` 与跨时刻画面 |
| 连续清晰 | `continuity` 与宽幅关键帧 |

## 判定流程

先确认波形横向连续，再比较低、高振幅态和线数，之后检查用户要求与基础质量。静态占位线不能证明音频响应。

## 通过与返修

通过要求波形连续、线数正确并存在实际时序变化。返修说明“波形断裂”“振幅未变化”“镜像缺失”或“线条不可辨”。

## 禁止事项

- 不输出采样数组、时间窗口、内部绘制数值或公式。
- 不根据音频输入直接宣称波形已出现。
- 不暴露资源、路径、后端或实现信息。
