# 纹理叠加自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `target` | 叠加目标 |
| `blendMode` | 混合模式 |
| `opacity` | 纹理不透明度 |
| `scale` | 纹理缩放 |
| `motion` | 纹理运动速度 |
| `motionAngle` | 纹理运动角度 |
| `premultipliedAlpha` | 预乘透明度 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入包括用户原始要求、自检 JSON 和最终成片关键帧合成图。JSON 顶层仅接受 `file_name`、`original_request`、`summary`、`metadata`。

## 核心原则

必须确认纹理真实出现在最终画面及目标区域，同时保留底图可辨性。不得只凭已选择纹理素材证明叠加成功。

## 自检视图字段及含义

- `texture_visibility`：实际纹理可见程度。
- `coverage`：大面积、局部或小范围覆盖及观察占比。
- `target_concentration`：纹理集中于中央、外围或均匀区域。
- `texture_motion`：纹理随时间稳定或移动的表现。
- `base_picture_legibility`、`base_contour_retention`：底图主体保留情况。
- `keyframe_contact_sheet`：来自最终成片、按时间合并的关键帧视觉证据。

## 关键帧检查规则

检查纹理最明显、位置变化和首尾稳定时刻，观察目标区域覆盖、重复接缝、拉伸、边界溢出和底图可辨性。帧数按实际变化确定。

## 用户要求到证据的映射

纹理强弱映射可见度；全局或局部映射覆盖范围；跟随或静止映射时间表现；不遮挡主体映射底图可辨性。

## 判定流程

先确认纹理真实可见，再核对覆盖范围和目标集中度，随后跨帧检查运动、接缝与拉伸，最后检查底图主体和用户意图。

## 通过与返修原则

纹理可见、覆盖正确、时间表现自然且底图可辨时通过。纹理缺失、覆盖错区、明显接缝或拉伸、边界溢出或严重压盖底图时返修。

## 禁止事项

不得用纹理素材或设置值代替成片证据，不得把素材本身纹理当作叠加结果，不得输出内部计算、路径、资源或抽帧安排。
