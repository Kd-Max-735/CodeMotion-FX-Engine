# 手持镜头 `handheld`

对服务端相机施加由请求 seed 决定的连续平移与旋转扰动，模拟可复现的手持拍摄，而不是逐帧随机跳动。

只输出 JSON，不附加解释。`type` 必须精确为 `handheld`。

```json
{"type":"handheld","data":{"intensity":0.35,"frequency":2.2,"translationJitter":0.08,"rotationJitterDegrees":1.5,"smoothing":0.55,"seedOffset":0}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `intensity` | 否 | `0..1`，默认 `0.35` | 总体手持强度 |
| `frequency` | 否 | `0.1..12`，默认 `2.2` | 每秒扰动节奏，越大越急促 |
| `translationJitter` | 否 | `0..1`，默认 `0.08` | 位置晃动幅度/距离 |
| `rotationJitterDegrees` | 否 | `0..15` 度，默认 `1.5` | 角度晃动幅度 |
| `smoothing` | 否 | `0..1`，默认 `0.55` | 越大越柔和稳定 |
| `seedOffset` | 否 | 整数 `0..1000000`，默认 `0` | 仅在要求另一种可复现节奏时改变 |

## 参数选择方法与优先级

- “轻微/强烈”先映射 `intensity`；“急促/缓慢晃动”映射 `frequency`。
- 明确角度写入 `rotationJitterDegrees`；明确移动距离写入 `translationJitter`。
- “柔和、稳定”提高 `smoothing`，“生硬、动作感”降低它。
- 左右、上下等固定方向不适用于随机手持；需要定向移动时改用 pan/tilt 或 dolly。
- 冲突时按“明确角度/位移 > 总强度 > 频率 > 柔和度 > seed 风格”处理；不要用频率代替强度。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 轻微纪录片手持 | `{"intensity":0.25,"frequency":1.8,"translationJitter":0.06,"rotationJitterDegrees":1,"smoothing":0.7,"seedOffset":0}` |
| 强烈而急促的动作镜头 | `{"intensity":0.9,"frequency":7,"translationJitter":0.25,"rotationJitterDegrees":5,"smoothing":0.15,"seedOffset":0}` |
| 只有轻微角度晃动 | `{"intensity":0.4,"frequency":2,"translationJitter":0,"rotationJitterDegrees":1.2,"smoothing":0.65,"seedOffset":0}` |
| 平移明显但角度稳定 | `{"intensity":0.55,"frequency":2.5,"translationJitter":0.2,"rotationJitterDegrees":0.2,"smoothing":0.5,"seedOffset":0}` |
| 换一种可复现的抖动节奏 | `{"intensity":0.35,"frequency":2.2,"translationJitter":0.08,"rotationJitterDegrees":1.5,"smoothing":0.55,"seedOffset":73}` |
| 使用默认手持 | `{"intensity":0.35,"frequency":2.2,"translationJitter":0.08,"rotationJitterDegrees":1.5,"smoothing":0.55,"seedOffset":0}` |

## 推荐值、默认值与边界

推荐纪录片范围：`intensity=0.2..0.5`、`frequency=1..3`、旋转 `0.5..2` 度、`smoothing=0.5..0.85`。中性无扰动值为 `intensity=0`；默认值见示例。

视频由服务端绑定。模型不选择视频、camera target 或资源。当前产品若只上传静态图片，必须先由服务器静态帧源适配生成视频帧源；不得把 `image` 直接绑定为 `video`。本工具不适用于明确方向的运镜、冲击抖屏转场、运动跟踪、真实传感器数据或不可复现的随机噪声。
