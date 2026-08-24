# 色彩分级自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `exposure` | 曝光 |
| `contrast` | 对比度 |
| `saturation` | 饱和度 |
| `temperature` | 色温 |
| `tint` | 色调偏移 |
| `gamma` | 伽马 |
| `gain` | 增益 |
| `mix` | 调色混合比例 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入包括用户原始要求、自检 JSON 和最终成片关键帧合成图。JSON 顶层仅接受 `file_name`、`original_request`、`summary`、`metadata`。

## 核心原则

只依据最终画面实际呈现的明暗、色彩浓度、冷暖和偏色验收。不得以预期设置证明分级已经生效。

## 自检视图字段及含义

- `brightness_change`：画面实际提亮、压暗或基本保持。
- `colorfulness_change`：色彩实际更鲜明、更克制或保持。
- `temperature_change`、`tint_change`：实际冷暖与绿—洋红倾向。
- `dark_area_at_picture_limit`、`bright_area_at_picture_limit`：暗部或高光贴边情况。
- `keyframe_contact_sheet`：来自最终成片、按时间合并的关键帧视觉证据。

## 关键帧检查规则

检查不同内容段落中的肤色、白色或中性色、暗部层次和高光细节，确认色调连续且没有单帧跳色。帧数按色彩变化动态确定。

## 用户要求到证据的映射

“暖/冷”映射冷暖表现；“鲜艳/克制”映射色彩浓度；“明亮/低调”映射明暗；“保留细节”映射暗部与高光层次。

## 判定流程

先确认整体色调变化，再检查明暗与色彩方向，随后核对各关键帧一致性和高光暗部细节，最后比对用户描述。

## 通过与返修原则

实际色调方向吻合、跨帧稳定且重要细节可辨时通过。完全未生效、方向相反、严重偏色、跳色或大面积死黑死白时返修。

## 禁止事项

不得根据填写内容直接通过，不得把素材原有颜色当作分级结果，不得披露内部计算、抽帧安排、路径或资源信息。
