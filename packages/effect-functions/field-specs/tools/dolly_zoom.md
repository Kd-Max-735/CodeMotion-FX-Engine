# 推拉变焦镜头 `dolly_zoom`

相机真实前后移动，同时根据主体距离补偿垂直 FOV，使服务端绑定主体的投影尺寸基本恒定，产生经典空间压缩或扩张感。二维源素材使用从画面中心向边缘连续变化的主体保护权重和严格单调的全画面径向重映射，禁止硬切保护区或把主体局部重复采样到背景区域。

只输出 JSON，不输出解释。`type` 必须精确为 `dolly_zoom`；camera target 由服务端绑定，不得出现在 `data`。

```json
{"type":"dolly_zoom","data":{"direction":"forward","travelDistance":4,"initialTargetDistance":12,"initialFovDegrees":50,"duration":4,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `direction` | 否 | `forward` / `backward` / `forward_then_backward` / `backward_then_forward`，默认 `forward` | 决定单向或往返相机运动 |
| `travelDistance` | 否 | `0.1..80`，默认 `4` | 实际相机移动距离 |
| `initialTargetDistance` | 否 | `1..200`，默认 `12` | 起始主体距离；前推距离须小于其 90% |
| `initialFovDegrees` | 否 | `10..100` 度，默认 `50` | 补偿计算的起始 FOV |
| `duration` | 否 | `0.5..30` 秒，默认 `4` | 控制移动与变焦速度 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 两种运动共用同一缓动 |

## 参数选择方法与优先级

- “前推背景拉开”用 `forward`；“后拉背景压缩”用 `backward`；“先拉近再拉远”用 `forward_then_backward`，“先拉远再拉近”用 `backward_then_forward`。
- 距离表达优先写入 `travelDistance`；主体起始距离只有用户明确说明或服务端语境给出时才调整。
- 明确镜头角度/FOV 写入 `initialFovDegrees`；运行时 FOV 由补偿公式计算，不能再输出结束 FOV。
- 快慢用 `duration`；柔和度用 `easing`，二者不可取代距离强度。
- 冲突时按“方向 > 移动距离 > 起始主体距离 > 起始 FOV > 速度/柔和度”处理，并保证前推不穿过目标。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 做一个经典前推推拉变焦 | `{"direction":"forward","travelDistance":4,"initialTargetDistance":14,"initialFovDegrees":50,"duration":4,"easing":"ease_in_out"}` |
| 快速前推，效果强烈 | `{"direction":"forward","travelDistance":7,"initialTargetDistance":10,"initialFovDegrees":60,"duration":2,"easing":"ease_in"}` |
| 缓慢后拉压缩背景 | `{"direction":"backward","travelDistance":8,"initialTargetDistance":12,"initialFovDegrees":45,"duration":6,"easing":"ease_in_out"}` |
| 从长焦开始向后拉 | `{"direction":"backward","travelDistance":5,"initialTargetDistance":20,"initialFovDegrees":25,"duration":5,"easing":"ease_out"}` |
| 轻微、柔和的前推 | `{"direction":"forward","travelDistance":2,"initialTargetDistance":18,"initialFovDegrees":50,"duration":5,"easing":"ease_in_out"}` |
| 先拉近再拉远 | `{"direction":"forward_then_backward","travelDistance":4,"initialTargetDistance":14,"initialFovDegrees":50,"duration":6,"easing":"ease_in_out"}` |
| 先拉远再拉近 | `{"direction":"backward_then_forward","travelDistance":5,"initialTargetDistance":14,"initialFovDegrees":50,"duration":6,"easing":"ease_in_out"}` |
| 使用默认推拉变焦 | `{"direction":"forward","travelDistance":4,"initialTargetDistance":12,"initialFovDegrees":50,"duration":4,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐移动距离为起始主体距离的 `15%..55%`、`duration=3..7`、起始 FOV `35..65`。中性强度可用 `travelDistance` 约为目标距离的 `25%`；默认值见示例。

用户只需提供一张源图片；服务器静态帧源适配会生成受控视频帧，并从画面中心主体区域派生锁定的 camera target，不得把 `image` 直接绑定为 `video`。模型不输出目标坐标、资源 ID 或结束 FOV，资源身份也不会进入参数。组合方向在前半段到达最大位移与补偿 FOV，后半段回到起始相机状态。`forward` 必须表现为前推，画面外围向外展开；`backward` 必须表现为后拉，画面外围向中心收拢，不能把方向做反或把两个方向都降级成普通放大。中央主体附近使用平滑保护，保护权重向外围连续过渡；整个映射必须连续、单调且不得折回主体区域，即使移动幅度很大也不得出现重影、部件复制或撕裂。本工具不适用于纯数字 zoom、普通 dolly、无明确主体的镜头、环绕或转场。
