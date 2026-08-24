# 数值滚动自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `format` | 数字格式 |
| `duration` | 计数时长 |
| `easing` | 缓动方式 |
| `fromValue` | 起始数值 |
| `toValue` | 结束数值 |
| `numberColor` | 数字颜色 |
| `positionX` | 横向位置 |
| `positionY` | 纵向位置 |
| `size` | 数字尺寸 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

审查输入为四字段自检 JSON 和最终 MP4 的 `keyframe_contact_sheet`。数值属于实际可见内容，内部插值过程不进入视图。

## 核心原则

必须描述成片中实际显示的起始数值、中间顺序、终止数值、完整性、节奏和起终状态。仅有起止设定或计时完成记录不能证明视频显示正确。

## 自检视图字段

- `visible_sequence`：实际可见的起点、中间阶段与终点顺序。
- `start_value`、`end_value`：成片起终内容。
- `complete`：过程和终点是否完整。
- `counting_direction`、`rhythm`：实际方向和可见节奏。
- `start_state`、`end_state`：起始与最终停留状态。

## 关键帧规则

按实际起始值、中间值变化阶段、接近终点和完整终点选择帧；数量随数值跨度和节奏变化，不固定。必须按时间合成一张图。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 从某值到某值 | `start_value`、`end_value` 与起终关键帧 |
| 递增或递减 | `visible_sequence` 与 `counting_direction` |
| 匀速或前快后慢 | `rhythm` 与多个中间阶段 |
| 完整停留 | `complete`、`end_state` 与末段画面 |

## 判定流程

先读取起终可见内容，再按时间检查中间顺序和节奏，最后确认终值完整停留及画面质量。缺少任一必要阶段即返修。

## 通过与返修

通过要求内容正确、方向正确、顺序单调、终点完整。返修明确指出错误数值、跳序、节奏不符、过早结束或终点未停留。

## 禁止事项

- 不把算法、公式、后端、资源身份、路径或中间数据混入参数摘要。
- 不以计时任务完成代替可见数值完整性。
- 不暴露字形结构、后端或路径。
