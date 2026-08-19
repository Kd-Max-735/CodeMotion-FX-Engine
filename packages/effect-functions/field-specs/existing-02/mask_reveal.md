# 遮罩显现 `mask_reveal`

通过规则或自定义遮罩，让目标图片或视频逐步覆盖底层图片或视频。遮罩尚未覆盖的位置保持底层画面，覆盖区域显示目标画面，动画完成后定格在完整目标画面。对应现有特效 `fx.composite.maskReveal`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "mask_reveal",
  "data": {
    "progress": 1,
    "feather": 0.04,
    "invert": false,
    "shape": "circle",
    "motion": "expand",
    "centerX": 0.5,
    "centerY": 0.5,
    "rotation": 0,
    "size": 1
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `progress` | 是 | 数字 `0..1`，步长 `0.01` | 控制本次动画最终显现比例；完整转场使用 `1` |
| `feather` | 是 | 数字 `0..0.5`，步长 `0.005` | `0` 为硬边，越大遮罩边缘越柔和 |
| `invert` | 是 | 布尔值 | 正常遮罩 `false`；反向显现区域用 `true` |
| `shape` | 是 | `circle`、`ellipse`、`rectangle`、`diamond`、`custom` | 选择规则遮罩形状；用户提供自定义遮罩时使用 `custom` |
| `motion` | 是 | `expand`、`left_to_right`、`right_to_left`、`top_to_bottom`、`bottom_to_top` | 选择遮罩扩张或直线扫过方向 |
| `centerX` | 是 | 数字 `0..1`，步长 `0.01` | `expand` 时遮罩中心横坐标，左到右为 `0..1` |
| `centerY` | 是 | 数字 `0..1`，步长 `0.01` | `expand` 时遮罩中心纵坐标，上到下为 `0..1` |
| `rotation` | 是 | 数字 `-180..180`，步长 `1` | 矩形、菱形或椭圆遮罩的旋转角度 |
| `size` | 是 | 数字 `0.1..2`，步长 `0.01` | 规则遮罩的覆盖尺寸倍率 |

## 参数选择规则

- “完整显现、最后停在第二张”使用 `progress=1`；只有明确要求部分显现时才降低它。
- “圆形从人物脸部向外扩大”使用 `shape=circle`、`motion=expand`，并把人物脸部位置映射到 `centerX/centerY`。
- “椭圆、矩形、菱形遮罩扩张”分别使用 `ellipse`、`rectangle`、`diamond`，方向保持 `expand`。
- “从左向右显现”使用 `left_to_right`；其余上下左右方向按 `motion` 字面值选择。
- 用户明确上传或指定自定义遮罩时使用 `shape=custom`；自定义遮罩由服务端绑定，不在 JSON 中输出遮罩引用。
- “硬边、清晰轮廓”降低 `feather`；“柔和、羽化、渐隐边缘”提高它。
- 未提到反相时保持 `invert=false`。反相只改变动画中的可见区域，不改变动画完成后定格目标画面的要求。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 用圆形遮罩从画面中心扩张，最终完整显示第二张图 | `{"progress":1,"feather":0.04,"invert":false,"shape":"circle","motion":"expand","centerX":0.5,"centerY":0.5,"rotation":0,"size":1}` |
| 从左向右柔和地显示目标视频 | `{"progress":1,"feather":0.12,"invert":false,"shape":"rectangle","motion":"left_to_right","centerX":0.5,"centerY":0.5,"rotation":0,"size":1}` |
| 从右上角用旋转菱形扩张显现 | `{"progress":1,"feather":0.04,"invert":false,"shape":"diamond","motion":"expand","centerX":0.85,"centerY":0.15,"rotation":30,"size":1}` |
| 使用上传的自定义遮罩反向显现到八成 | `{"progress":0.8,"feather":0.04,"invert":true,"shape":"custom","motion":"expand","centerX":0.5,"centerY":0.5,"rotation":0,"size":1}` |

默认值为 `progress=1`、`feather=0.04`、`invert=false`、`shape=circle`、`motion=expand`、`centerX=0.5`、`centerY=0.5`、`rotation=0`、`size=1`。

底层画面、目标画面与可选自定义遮罩由服务端绑定。底层和目标素材都可以是图片或视频；视频由服务端逐帧解码。不要生成素材 ID、遮罩 ID、路径或 URL。工具只返回上述效果参数，不把任何资源字段写入 Tool Call JSON。
