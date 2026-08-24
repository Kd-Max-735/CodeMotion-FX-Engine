# 起音触发自检规则

<!-- self-check-parameter-contract:start -->
## 重要参数契约

- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。
- 这里只显示对最终视频变化有直接判断价值的重要参数：

| JSON key | 中文名称 |
| --- | --- |
| `threshold` | 触发阈值 |
| `cooldown` | 触发冷却 |
| `retriggerMode` | 重复触发模式 |
| `strength` | 触发强度 |

- 每项结构固定为 `{ "label": "中文名称", "value": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。
- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。
<!-- self-check-parameter-contract:end -->

## 输入契约

审查输入为 `file_name`、`original_request`、`summary`、`metadata` 结构的自检 JSON，以及从最终 MP4 生成的一张 `keyframe_contact_sheet`。

## 核心原则

起音触发必须在成片中表现为可见的突发变化。只看到起音分析结果、触发记录或执行成功，不等于目标表现已经出现。

## 自检视图字段

- `visible_trigger_count`：成片中彼此可区分的触发次数。
- `trigger_sharpness`：可见变化的突发程度。
- `post_trigger_recovery`：触发后是否回稳。
- `observed_response`：对实际成片响应的文字描述。
- `metadata.media`、`metadata.quality`、`metadata.keyframe_evidence`：视频与证据事实。

## 关键帧规则

按实际突发时刻选触发前、触发瞬间、触发后。触发次数不固定；密集触发也必须选择能分辨相邻事件的画面，不得只复制同一帧。

## 用户要求到证据映射

| 用户要求 | 首选证据 |
| --- | --- |
| 精准触发 | 触发前后突变与 `visible_trigger_count` |
| 强冲击 | `trigger_sharpness` 与触发瞬间 |
| 避免连发 | 相邻触发间隔的关键帧序列 |
| 触发后恢复 | `post_trigger_recovery` 与触发后画面 |

## 判定流程

从最终画面定位突发变化，确认前后状态可区分，再判断次数、锐度、回稳及用户要求。缺少成片突变证据即失败。

## 通过与返修

通过要求至少一次实际可见触发，且没有无法解释的粘连或漏显。返修只描述“触发未出现”“响应不够突然”或“触发后未回稳”等可见问题。

## 禁止事项

- 不展示音频分析、触发阈值、冷却记录或内部目标信息。
- 不用后台事件日志替代最终视频证据。
- 不暴露算法、公式、资源或路径。
