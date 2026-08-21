# 虚线沿路径流动 `dash_flow`

在用户上传图片上，根据自然语言给出的坐标或服务端派生的主体锚点生成路径，再将其分割为可移动的弧长虚线段。需要调用时只输出 JSON，不要附加解释、Markdown 或代码块：

```json
{"type":"dash_flow","data":{"dashLength":32,"gapLength":18,"speed":80,"direction":"forward","offset":0,"lineCap":"round","startX":0.15,"startY":0.5,"endX":0.85,"endY":0.5,"curve":0,"color":"#20dcff","thickness":3,"startAnchor":"coordinates","endAnchor":"coordinates"}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `dashLength` | 否 | `1..500` px，默认 `32` | 单段实线长度 |
| `gapLength` | 否 | `1..500` px，默认 `18` | 段间空隙长度 |
| `speed` | 否 | `0..2000` px/s，默认 `80` | `0` 为静止虚线 |
| `direction` | 否 | `forward/reverse`，默认 `forward` | `forward` 严格表示从 `start` 流向 `end`；`reverse` 表示从 `end` 流向 `start` |
| `offset` | 否 | `-2000..2000` px，默认 `0` | 调整首段起始位置 |
| `lineCap` | 否 | `butt/round/square`，默认 `round` | 工程线用 `butt`，柔和光点用 `round` |
| `startX` | 否 | `0..1`，默认 `0.15` | 起点横向位置，0 为左、1 为右 |
| `startY` | 否 | `0..1`，默认 `0.5` | 起点纵向位置，0 为上、1 为下 |
| `endX` | 否 | `0..1`，默认 `0.85` | 终点横向位置 |
| `endY` | 否 | `0..1`，默认 `0.5` | 终点纵向位置 |
| `curve` | 否 | `-1..1`，默认 `0` | 0 为直线，正负值向连线两侧弯曲 |
| `color` | 否 | `#RRGGBB`，默认 `#20dcff` | 虚线颜色 |
| `thickness` | 否 | `0.5..30` px，默认 `3` | 虚线线宽 |
| `startAnchor` | 否 | `coordinates/subject_left/subject_right/subject_top/subject_bottom/subject_center/brightest`，默认 `coordinates` | 起点定位模式；非坐标模式由服务器分析授权图片 |
| `endAnchor` | 否 | 同 `startAnchor`，默认 `coordinates` | 终点定位模式；非坐标模式由服务器分析授权图片 |

## 参数选择规则

1. 本工具收到上传图片时，模型会在服务端受控地读取该图。用户点名“鸟头到鸟尾”“汽车车头到车尾”等可见语义目标时，必须在图片中分别定位两个目标的视觉中心，使用 `startAnchor="coordinates"`、`endAnchor="coordinates"`，并写入对应的 `startX/startY/endX/endY`。坐标以左上角为原点，横向和纵向均为 `0..1`。
2. 用户直接给出百分比或画面方位时同样使用 `coordinates`；例如“左上到右下”可用 `(0.15,0.2)` 到 `(0.85,0.8)`。只有视觉输入不可用或用户明确要求主体边界/最亮处时，才使用对应 `subject_*` 或 `brightest` 降级锚点。
3. 再确定 `curve`、`color` 和 `thickness`，然后确定虚线比例：短划线用小 `dashLength`，稀疏节奏用大 `gapLength`。
4. 运动方向只由 `direction` 表达，不输出负 `speed`。用户说“从 A 向 B 流动”时，A 是 start、B 是 end，并使用 `direction="forward"`。
5. 用户没有明确对齐要求时保持 `offset=0`；端帽风格最后决定。起点和终点必须至少相距画布比例 `0.02`。

| 自然语言 | 参数对应 |
| --- | --- |
| 细密的行进蚁线 | `dashLength=8, gapLength=7, speed=40, lineCap="butt"` |
| 长条信号快速向前 | `dashLength=90, gapLength=24, speed=220` |
| 虚线缓慢倒流 | `speed=30, direction="reverse"` |
| 静止的工程虚线 | `speed=0, lineCap="butt"` |
| 每段和空隙一样长 | `dashLength=24, gapLength=24` |
| 起点向后错开十像素 | `offset=-10` |
| 红色粗虚线从左上弯向右下 | `startX=0.15, startY=0.2, endX=0.85, endY=0.8, curve=0.3, color="#ff3344", thickness=6` |
| 蓝色细虚线从画面中央流向右侧 | `startX=0.5, startY=0.5, endX=0.9, endY=0.5, curve=0, color="#238cff", thickness=2` |
| 从主体左端流向主体右端 | `startAnchor="subject_left", endAnchor="subject_right"` |
| 从最亮处流向主体底部 | `startAnchor="brightest", endAnchor="subject_bottom"` |

| 程度 | `speed` | `dashLength/gapLength` |
| --- | ---: | --- |
| 轻微 | `20` | `24/18` |
| 中等 | `80` | `32/18` |
| 明显 | `220` | `48/16` |
| 强烈 | `600` | `80/12` |

默认值为示例中的完整 `data`。中性动画值是 `speed=0`、`offset=0`；几何没有完全中性值。工具不适用于实体描边生长、粒子沿路径飞行或多路径连接。`data` 中不得出现素材或资源标识。

模型视觉定位只用于把当前提示中点名的可见起点和终点转换为归一化坐标；图片身份、路径和内容不得进入 `data`。如果目标被遮挡、在画外、边界含糊或图片格式/大小无法作为视觉输入，不能保证像素级定位，此时使用明确方位、坐标或服务器降级锚点。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：用户上传的一张基础图片，生成的虚线路径绘制在该图片上。图片身份不进入模型参数；模型不得输出资源身份、文件路径或 URL。
