# 文字变形自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `sourceText` | 起始文字 |
| `targetText` | 目标文字 |
| `matchMode` | 字符匹配模式 |
| `progress` | 变形进度 |
| `duration` | 变形时长 |
| `fontSize` | 字号 |
| `sourcePositionX` | 起始横向位置 |
| `sourcePositionY` | 起始纵向位置 |
| `targetPositionX` | 目标横向位置 |
| `targetPositionY` | 目标纵向位置 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

审查只接收四字段自检 JSON 与最终 MP4 生成的 `keyframe_contact_sheet`。源文字和目标文字是可见交付内容，内部字形结构不进入视图。

## 核心原则

必须描述实际源内容、实际目标内容、形态变化顺序、完整性、节奏和起终状态。不能只用源目标文字设定或变形完成记录证明视觉过渡已经出现。

## 自检视图字段

- `source_content`、`target_content`：成片源态与目标态的实际内容。
- `morph_sequence`：源态、中间形态、目标态的顺序。
- `source_state`、`transition_state`、`target_state`：三个阶段的可见性。
- `complete`：目标末态是否完整。

## 关键帧规则

至少覆盖清晰源态、一个或多个有意义的中间形态、清晰目标态；形态变化复杂时增加关键帧。所有画面按时间合为一张图。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 从指定文字变到目标文字 | 源目标字段与起终画面 |
| 平滑变形 | `transition_state` 与连续中间形态 |
| 完整到达目标 | `complete`、`target_state` 与末态 |
| 移动或颜色变化 | 中间态与目标态的实际画面 |

## 判定流程

先核对源态和目标态内容，再确认中间形态真实存在且顺序正确，最后检查完整性、节奏和画面质量。直接跳切不能冒充变形。

## 通过与返修

通过要求源目标内容正确、中间变形可见、目标完整。返修指出内容颠倒、缺少中间态、跳切、残影或目标不完整。

## 禁止事项

- 不输出字形数组、匹配表、时间计划、公式或内部状态。
- 不以源目标输入正确代替成片形态检查。
- 不暴露字体、资源、路径、后端或实现信息。
