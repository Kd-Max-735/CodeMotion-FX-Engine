# 方向模糊自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `angle` | 模糊角度 |
| `distance` | 模糊距离 |
| `samples` | 采样数量 |
| `edgeMode` | 边缘模式 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入包括用户原始要求、自检 JSON 和最终成片关键帧合成图。JSON 顶层仅接受 `file_name`、`original_request`、`summary`、`metadata`。

## 核心原则

方向模糊必须呈现集中于同一轴向的拖开效果。仅有整体变软不足以证明方向模糊成立。

## 自检视图字段及含义

- `directional_trail`：实际拖影方向和观察角度。
- `trail_visibility`：拖影实际可见程度。
- `direction_coherence`：不同轮廓的拖影方向集中程度。
- `contour_retention`：拖影后主体轮廓保留情况。
- `keyframe_contact_sheet`：来自最终成片、按时间合并的关键帧视觉证据。

## 关键帧检查规则

沿高反差轮廓检查拖影轴向，比较不同位置是否保持同向，并观察边缘裁切、重影和主体可辨性。按方向表现变化动态选帧。

## 用户要求到证据的映射

水平、垂直或斜向要求映射实际拖影轴；强弱描述映射可见程度；“整齐”映射方向集中度；“主体清楚”映射轮廓保留。

## 判定流程

先确认存在单向拖影，再核对轴向和强弱，随后检查跨区域一致性及边缘完整性，最后比对用户要求。

## 通过与返修原则

拖影轴明确、方向吻合且画面无非目标损伤时通过。仅整体柔化、方向散乱、轴向相反、严重重影或裁边时返修。

## 禁止事项

不得从设置推定方向，不得把普通失焦当成方向模糊，不得输出内部计算、路径、资源或抽帧安排。
