# 高斯模糊自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `radius` | 模糊半径 |
| `passes` | 模糊遍数 |
| `edgeMode` | 边缘模式 |
| `alphaAware` | 透明度感知 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

输入包括用户原始要求、自检 JSON 和最终成片关键帧合成图。JSON 顶层仅接受 `file_name`、`original_request`、`summary`、`metadata`。

## 核心原则

必须从最终画面的轮廓与细纹理确认均匀柔化。目标模糊不等同于拍摄失焦，验收重点是柔化形态是否符合请求并保持画面完整。

## 自检视图字段及含义

- `blur_appearance`：实际整体柔化程度。
- `contour_softness`：主要轮廓的柔化与保留表现。
- `fine_texture_retention`：细小纹理保留程度。
- `directional_uniformity`：各方向是否均匀柔化。
- `keyframe_contact_sheet`：来自最终成片、按时间合并的关键帧视觉证据。

## 关键帧检查规则

检查高反差边缘、文字或主体轮廓与纹理区域，确认柔化连续、各方向相近且无局部破洞。按模糊强弱变化动态选帧。

## 用户要求到证据的映射

“轻柔/强烈”映射柔化程度；“均匀”映射方向一致性；“仍可辨”映射轮廓与纹理保留；局部要求需在对应画面区域得到支持。

## 判定流程

先确认轮廓和细节确实柔化，再检查方向均匀性与跨帧稳定性，排除单向拖影、重影和编码损伤，最后核对用户强弱描述。

## 通过与返修原则

柔化可见、近似各向均匀且符合用户意图时通过。无效果、出现明显单向拖尾、局部漏模糊或画面不可辨时返修。

## 禁止事项

不得用输入设置证明模糊存在，不得把目标柔化标成拍摄失焦，不得披露内部计算、路径、资源或抽帧安排。
