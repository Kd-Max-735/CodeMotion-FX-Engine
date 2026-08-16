# 景深分层视差 `parallax_layers`

依据服务端绑定的深度图把视频重建为多层空间切片，再移动虚拟相机形成真实深度相关视差。模型不生成或选择深度图。

只输出 JSON，不输出解释、资源或路径。`type` 必须精确为 `parallax_layers`。

```json
{"type":"parallax_layers","data":{"travelX":1.5,"travelY":0,"travelZ":2,"depthStrength":0.65,"nearDepth":0.1,"farDepth":0.9,"layerCount":8,"duration":4,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `travelX` | 否 | `-20..20`，默认 `1.5` | 负值向左，正值向右 |
| `travelY` | 否 | `-20..20`，默认 `0` | 负值向下，正值向上 |
| `travelZ` | 否 | `-50..50`，默认 `2` | 负值后退，正值推进 |
| `depthStrength` | 否 | `0..2`，默认 `0.65` | 前后层位移差强度 |
| `nearDepth` | 否 | `0..0.9`，默认 `0.1` | 近层深度阈值，须小于远层 |
| `farDepth` | 否 | `0.1..1`，默认 `0.9` | 远层深度阈值 |
| `layerCount` | 否 | 整数 `2..32`，默认 `8` | 空间分层数量 |
| `duration` | 否 | `0.5..30` 秒，默认 `4` | 控制空间移动速度 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 控制起止柔和度 |

## 参数选择方法与优先级

- 左右/上下/前后方向分别映射 `travelX/Y/Z` 的符号，明确距离直接用相应轴数值。
- 快慢由 `duration`；柔和度由 `easing`，视差强弱由 `depthStrength`，三者不可互代。
- 角度表达不适用于本工具；需要旋转环绕应使用 orbit。
- “层次更细”提高 `layerCount`；除非用户明确指定深度范围，否则保持 `nearDepth/farDepth` 默认值。
- 冲突时按“明确轴向距离 > 视差强度 > 分层数 > 深度范围 > 速度/柔和度”处理，并保持 `nearDepth < farDepth`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 向右轻微移动产生视差 | `{"travelX":1,"travelY":0,"travelZ":0,"depthStrength":0.4,"nearDepth":0.1,"farDepth":0.9,"layerCount":6,"duration":4,"easing":"ease_in_out"}` |
| 快速向前穿过景深 | `{"travelX":0,"travelY":0,"travelZ":10,"depthStrength":1,"nearDepth":0.05,"farDepth":1,"layerCount":12,"duration":1.5,"easing":"ease_in"}` |
| 缓慢向左上方移动 | `{"travelX":-3,"travelY":2,"travelZ":1,"depthStrength":0.65,"nearDepth":0.1,"farDepth":0.9,"layerCount":10,"duration":7,"easing":"ease_in_out"}` |
| 做更细的 20 层视差 | `{"travelX":1.5,"travelY":0,"travelZ":2,"depthStrength":0.7,"nearDepth":0.1,"farDepth":0.9,"layerCount":20,"duration":4,"easing":"ease_in_out"}` |
| 很强但柔和的纵深后退 | `{"travelX":0,"travelY":0,"travelZ":-8,"depthStrength":1.5,"nearDepth":0.05,"farDepth":0.95,"layerCount":16,"duration":6,"easing":"ease_in_out"}` |
| 使用默认分层视差 | `{"travelX":1.5,"travelY":0,"travelZ":2,"depthStrength":0.65,"nearDepth":0.1,"farDepth":0.9,"layerCount":8,"duration":4,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐 `depthStrength=0.35..1`、`layerCount=6..16`、单轴移动 `1..8`、`duration=3..7`。中性无运动值为 `travelX=travelY=travelZ=0`，无视差值为 `depthStrength=0`；默认值见示例。

视频、深度图和可选 camera target 由服务端绑定。当前产品若只上传静态图片，必须先由服务器静态帧源适配生成视频帧源；不得把 `image` 直接绑定为 `video`，静态帧适配也不能生成或冒充 `depth_map`。本工具不适用于生成深度图、真实 3D 网格重建、无深度输入的猜测、对象分割、环绕旋转或多特效合成。
