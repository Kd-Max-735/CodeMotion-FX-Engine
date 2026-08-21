# 环绕镜头 `orbit`

让服务端相机绕已绑定的 camera target 沿球面轨迹运动，持续保持目标居中，并输出真实位置、旋转和 view matrix。

只输出 JSON。`type` 必须精确为 `orbit`，不要输出目标坐标或资源信息。

```json
{"type":"orbit","data":{"azimuthDegrees":90,"elevationDegrees":10,"radius":8,"duration":5,"verticalFovDegrees":50,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `azimuthDegrees` | 否 | `-360..360` 度，默认 `90` | 正负决定水平环绕方向 |
| `elevationDegrees` | 否 | `-80..80` 度，默认 `10` | 正值升高，负值降低 |
| `radius` | 否 | `0.1..100`，默认 `8` | 相机到目标的环绕距离 |
| `duration` | 否 | `0.5..30` 秒，默认 `5` | 控制环绕速度 |
| `verticalFovDegrees` | 否 | `10..120` 度，默认 `50` | 固定视角 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 控制起止节奏 |

## 参数选择方法与优先级

- 顺/逆向环绕用 `azimuthDegrees` 正负表达；明确角度直接采用，半圈是约 `180` 度。
- “边绕边升高/降低”写入 `elevationDegrees`；距离写入 `radius`。
- 快慢用 `duration`；柔和用 `easing`；FOV 仅处理广角/长焦表达。
- camera target 的身份和坐标不能由模型选择，只能使用服务端绑定。
- 冲突时按“明确水平角度/方向 > 高度角 > 半径 > FOV > 速度/柔和度”处理。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 顺向环绕四分之一圈 | `{"azimuthDegrees":90,"elevationDegrees":0,"radius":8,"duration":4,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 反向绕半圈 | `{"azimuthDegrees":-180,"elevationDegrees":0,"radius":10,"duration":7,"verticalFovDegrees":50,"easing":"ease_in_out"}` |
| 边环绕边升高 30 度 | `{"azimuthDegrees":120,"elevationDegrees":30,"radius":9,"duration":6,"verticalFovDegrees":50,"easing":"ease_out"}` |
| 近距离快速绕一圈 | `{"azimuthDegrees":360,"elevationDegrees":5,"radius":3,"duration":2.5,"verticalFovDegrees":65,"easing":"linear"}` |
| 远距离长焦缓慢环绕 | `{"azimuthDegrees":90,"elevationDegrees":10,"radius":25,"duration":10,"verticalFovDegrees":28,"easing":"ease_in_out"}` |
| 使用默认环绕 | `{"azimuthDegrees":90,"elevationDegrees":10,"radius":8,"duration":5,"verticalFovDegrees":50,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐水平角 `60..180`、高度角 `-20..35`、半径 `4..15`、时长 `4..8` 秒。中性值为 `azimuthDegrees=0`、`elevationDegrees=0`、FOV `50`；默认值见示例。

用户只需提供一张源图片；服务器静态帧源适配会生成受控视频帧，并从画面中心主体派生锁定的 camera target，不得把 `image` 直接绑定为 `video`。模型不能输出目标身份、坐标或资源信息。合成必须利用画面深浅差异产生前景和背景反向位移，形成可辨识的二维半环绕近似，而不是普通横移或缩放。本工具不适用于无目标环绕、直线 dolly、pan/tilt 原地旋转、手持抖动或素材选择。
