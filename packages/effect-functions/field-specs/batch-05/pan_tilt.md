# 摇移俯仰镜头 `pan_tilt`

在服务端相机上施加水平 pan 与垂直 tilt 旋转，并输出真实 view matrix。可选 camera target 由服务端绑定，模型不输出目标坐标。

只输出 JSON，不要附加解释。`type` 必须精确为 `pan_tilt`。

```json
{"type":"pan_tilt","data":{"panDegrees":30,"tiltDegrees":0,"duration":2,"verticalFovDegrees":50,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `panDegrees` | 否 | `-180..180` 度，默认 `30` | 负值向左，正值向右 |
| `tiltDegrees` | 否 | `-90..90` 度，默认 `0` | 负值向下，正值向上 |
| `duration` | 否 | `0.2..20` 秒，默认 `2` | 越小旋转越快 |
| `verticalFovDegrees` | 否 | `10..120` 度，默认 `50` | 小值长焦，大值广角 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 控制旋转起止节奏 |

## 参数选择方法与优先级

- 左右方向只改 `panDegrees` 的符号，上下方向只改 `tiltDegrees` 的符号。
- 明确角度直接采用；“轻微/大幅”可分别取约 `10..20` / `60..120` 度。
- 快慢用 `duration`；距离表达不移动相机，应改用 dolly，而不是 FOV 冒充距离。
- “宽广/压缩”才调整 `verticalFovDegrees`；柔和度由 `easing` 和较长 `duration` 表达。
- 冲突时按“明确角度 > 明确方向 > FOV > 速度 > 柔和风格”处理；pan 与 tilt 可同时存在。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 向左摇 45 度 | `{"panDegrees":-45,"tiltDegrees":0,"duration":2,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 快速向上仰 30 度 | `{"panDegrees":0,"tiltDegrees":30,"duration":0.7,"verticalFovDegrees":50,"easing":"ease_out"}` |
| 慢慢向右下方扫视 | `{"panDegrees":60,"tiltDegrees":-20,"duration":4,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 用广角轻微左摇 | `{"panDegrees":-15,"tiltDegrees":0,"duration":2,"verticalFovDegrees":85,"easing":"ease_in_out"}` |
| 长焦缓慢抬头 | `{"panDegrees":0,"tiltDegrees":20,"duration":3.5,"verticalFovDegrees":25,"easing":"ease_out"}` |
| 使用默认摇镜 | `{"panDegrees":30,"tiltDegrees":0,"duration":2,"verticalFovDegrees":50,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐一般摇镜角度 `15..60` 度、`duration=1.5..4`、FOV `35..65`。中性值为 `panDegrees=0`、`tiltDegrees=0`、`verticalFovDegrees=50`；默认值见示例。

视频与 camera target 由服务端绑定。模型不输出视频、目标坐标或路径。本工具不适用于相机位移、环绕、推拉变焦、随机手持震动或素材裁切。
