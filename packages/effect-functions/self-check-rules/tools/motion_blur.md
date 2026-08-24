# 运动模糊自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `shutterAngle` | 快门角度 |
| `samples` | 采样数量 |
| `velocity` | 运动速度 |
| `centered` | 居中采样 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入包括用户原始要求、自检 JSON 和最终成片关键帧合成图。JSON 顶层仅接受 `file_name`、`original_request`、`summary`、`metadata`。

## 核心原则

运动模糊应表现为与画面运动感一致的拖影。不得把合乎意图的运动拖影误判为失焦，也不得以整体变软冒充运动模糊。

## 自检视图字段及含义

- `motion_trail`：实际观察到的运动拖影方向。
- `trail_visibility`：拖影强弱与速度感。
- `trail_distribution`、`two_side_balance`：单侧拖尾或双侧分布表现。
- `motion_blur_is_not_focus_failure`：目标拖影的误判保护说明。
- `keyframe_contact_sheet`：来自最终成片、按时间合并的关键帧视觉证据。

## 关键帧检查规则

优先检查运动最明显和变化最大的时刻，观察拖影是否依附主体轮廓、方向是否连贯、静止或低运动区域是否异常糊化。帧数不固定。

## 用户要求到证据的映射

运动方向映射拖影轴；速度感映射拖影可见度；“单侧拖尾/均衡拖开”映射分布；保持主体辨识映射轮廓状态。

## 判定流程

先确认拖影而非普通柔化，再核对方向和分布，随后检查其与跨帧运动感是否一致，并排除全片失焦、重影和边缘破损。

## 通过与返修原则

拖影方向与运动感一致、强弱符合要求且主体可辨时通过。无拖影、仅失焦、方向冲突、静止区域异常糊化或画面破损时返修。

## 禁止事项

不得把正常运动模糊判成失焦故障，不得根据设置值直接通过，不得披露内部计算、路径、资源或抽帧安排。
