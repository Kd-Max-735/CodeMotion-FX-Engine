# 轨道推拉镜头 `dolly`

沿相机视线方向执行真实位置平移，可叠加升降偏移；FOV 保持固定，因此不同于数字缩放和推拉变焦。

只输出 JSON。`type` 必须精确为 `dolly`，不得输出 camera target、视频或资源信息。

```json
{"type":"dolly","data":{"direction":"forward","distance":5,"heightOffset":0,"duration":3,"verticalFovDegrees":50,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `direction` | 否 | `forward` / `backward` / `forward_then_backward` / `backward_then_forward`，默认 `forward` | 推近、拉远或按顺序完成往返运动 |
| `distance` | 否 | `0..100`，默认 `5` | 相机平移距离 |
| `heightOffset` | 否 | `-20..20`，默认 `0` | 正值上升，负值下降 |
| `duration` | 否 | `0.2..30` 秒，默认 `3` | 控制移动速度 |
| `verticalFovDegrees` | 否 | `10..120` 度，默认 `50` | 固定镜头视角 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 控制轨道运动节奏 |

## 参数选择方法与优先级

- 方向先映射 `direction`，移动量写入 `distance`；不要用负距离表达后退。“先拉近再拉远”必须选 `forward_then_backward`，“先拉远再拉近”必须选 `backward_then_forward`。
- 明确速度若没有时长，快速用约 `0.8..1.5` 秒，缓慢用约 `4..8` 秒。
- 上升/下降距离写入 `heightOffset`；角度表达不适用，除非用户明确要求广角/长焦 FOV。
- 柔和移动使用 `ease_in_out` 和较长 `duration`；FOV 不用于伪造推进距离。
- 冲突时按“明确方向 > 明确距离/高度 > 明确时长 > FOV > 风格词”处理。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 缓慢向前推进 4 米 | `{"direction":"forward","distance":4,"heightOffset":0,"duration":5,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 快速后拉 10 米 | `{"direction":"backward","distance":10,"heightOffset":0,"duration":1.2,"verticalFovDegrees":50,"easing":"ease_out"}` |
| 一边推进一边升高 | `{"direction":"forward","distance":6,"heightOffset":3,"duration":4,"verticalFovDegrees":45,"easing":"ease_in_out"}` |
| 向后并下降两米 | `{"direction":"backward","distance":7,"heightOffset":-2,"duration":3,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 用广角平稳推进 | `{"direction":"forward","distance":5,"heightOffset":0,"duration":3.5,"verticalFovDegrees":80,"easing":"linear"}` |
| 先拉近再拉远并回到起点 | `{"direction":"forward_then_backward","distance":6,"heightOffset":0,"duration":5,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 先拉远再拉近并回到起点 | `{"direction":"backward_then_forward","distance":6,"heightOffset":0,"duration":5,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 使用默认轨道推进 | `{"direction":"forward","distance":5,"heightOffset":0,"duration":3,"verticalFovDegrees":50,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐 `distance=2..12`、`duration=2..6`、`heightOffset=-2..3`。中性值为 `distance=0`、`heightOffset=0`、FOV `50`；默认值见示例。大于 30 的距离应有明确远距离语义。

视频和可选 camera target 由服务端绑定。当前产品若只上传静态图片，必须先由服务器静态帧源适配生成视频帧源；不得把 `image` 直接绑定为 `video`。组合方向在前半段到达 `distance`，后半段返回起点。本工具不适用于数字缩放、主体尺寸恒定的 dolly zoom、旋转摇镜、环绕或镜头抖动。
