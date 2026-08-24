# 打字机显现自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `speed` | 打字速度 |
| `cursor` | 光标样式 |
| `wordMode` | 按词显示 |
| `cursorWidth` | 光标宽度 |
| `text` | 文字内容 |
| `fontSize` | 字号 |
| `positionX` | 横向位置 |
| `positionY` | 纵向位置 |
| `color` | 文字颜色 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入为四字段自检 JSON 与最终 MP4 的单张 `keyframe_contact_sheet`。文字内容可公开审查，字形数组和内部显现计划不可见。

## 核心原则

必须描述成片中的实际文字内容、从前到后的显现顺序、阶段完整性、节奏、游标表现及起终状态。不能仅根据文字输入或显现速度设定判定通过。

## 自检视图字段

- `visible_content`：成片中实际可见的完整文字。
- `reveal_order`、`stage_sequence`：显现方向和阶段顺序。
- `complete`：末段是否完整显示。
- `cursor_visible`：成片中是否实际显示游标。
- `start_state`、`end_state`：开始与最终停留状态。

## 关键帧规则

根据文字实际显现阶段选择开始、少量字符、中段、接近完整、完整末态；长文本可以增加帧，短文本不得机械复制。按时间合并为一张图。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 指定文字 | `visible_content` 与完整末态 |
| 逐字或分段出现 | `reveal_order`、`stage_sequence` 与中间帧 |
| 快慢节奏 | 跨阶段关键帧的实际推进 |
| 带或不带游标 | `cursor_visible` 与清晰关键帧 |
| 最终完整 | `complete`、`end_state` 与末段停留 |

## 判定流程

逐帧核对内容增长顺序，检查是否漏字、乱序或过早完整，再核对游标、节奏和末态。输入文本正确但成片不完整仍应失败。

## 通过与返修

通过要求内容一致、顺序正确、阶段连续、末态完整。返修说明漏字、乱序、节奏不符、游标错误或末态未完整。

## 禁止事项

- 不把算法、公式、后端、资源身份、路径或中间数据混入参数摘要。
- 不用输入文字替代最终画面检查。
- 不暴露字体资源、路径、后端或实现信息。
