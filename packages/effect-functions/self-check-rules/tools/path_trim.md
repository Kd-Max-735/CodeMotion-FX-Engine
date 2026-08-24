# 路径修剪自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `target` | 修剪目标 |
| `mode` | 修剪模式 |
| `duration` | 修剪时长 |
| `direction` | 修剪方向 |
| `strokeWidth` | 描边宽度 |
| `strokeColor` | 描边颜色 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

审查输入为四字段自检 JSON 与最终 MP4 的 `keyframe_contact_sheet`。只描述可见路径推进、方向、覆盖变化、连续性及起终状态。

## 核心原则

必须根据最终画面判断路径是否从起态连续推进到终态。路径数据、遮罩、方向设定或执行完成不能替代成片中的真实显现或擦除过程。

## 自检视图字段

- `visible_path_progression`：实际起态、中段和终态顺序。
- `direction`：成片中可见推进方向。
- `coverage_change`：覆盖变化是否连续。
- `stroke_continuity`：可见描边是否连续。
- `start_state`、`end_state`、`complete`：起终状态与完整性。

## 关键帧规则

根据实际路径起点、推进中段、方向转折、接近完成和完整终态选帧。复杂轮廓可以增加帧；所有画面按时间合成一张图。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 显现或擦除 | `start_state`、`end_state` 与起终画面 |
| 指定方向 | `direction` 与多个推进阶段 |
| 连续描绘 | `coverage_change`、`stroke_continuity` 与中间帧 |
| 完整结束 | `complete` 与终态停留 |

## 判定流程

先确认起态，再按时间追踪路径覆盖与方向，随后检查描边连续性、终态完整性和画面质量。跳变、反向或半途停止均应返修。

## 通过与返修

通过要求推进方向正确、覆盖连续、描边完整并到达期望终态。返修说明方向错误、路径断裂、覆盖跳变、边缘裁切或终态未完成。

## 禁止事项

- 不把算法、公式、后端、资源身份、路径或中间数据混入参数摘要。
- 不用路径输入或遮罩正确代替成片推进证据。
- 不暴露资源、路径、后端或实现信息。
