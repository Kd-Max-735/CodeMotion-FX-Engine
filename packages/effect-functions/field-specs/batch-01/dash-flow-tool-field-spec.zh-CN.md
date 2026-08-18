# 虚线沿路径流动 `dash_flow`

把服务端绑定路径分割为可移动的弧长虚线段。需要调用时只输出 JSON，不要附加解释、Markdown 或代码块：

```json
{"type":"dash_flow","data":{"dashLength":32,"gapLength":18,"speed":80,"direction":"forward","offset":0,"lineCap":"round"}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `dashLength` | 否 | `1..500` px，默认 `32` | 单段实线长度 |
| `gapLength` | 否 | `1..500` px，默认 `18` | 段间空隙长度 |
| `speed` | 否 | `0..2000` px/s，默认 `80` | `0` 为静止虚线 |
| `direction` | 否 | `forward/reverse`，默认 `forward` | 按语义选择前进或反向 |
| `offset` | 否 | `-2000..2000` px，默认 `0` | 调整首段起始位置 |
| `lineCap` | 否 | `butt/round/square`，默认 `round` | 工程线用 `butt`，柔和光点用 `round` |

## 参数选择规则

1. 先确定虚线比例：短划线用小 `dashLength`，稀疏节奏用大 `gapLength`。
2. 运动方向只由 `direction` 表达，不输出负 `speed`。
3. 用户没有明确对齐要求时保持 `offset=0`；端帽风格最后决定。

| 自然语言 | 参数对应 |
| --- | --- |
| 细密的行进蚁线 | `dashLength=8, gapLength=7, speed=40, lineCap="butt"` |
| 长条信号快速向前 | `dashLength=90, gapLength=24, speed=220` |
| 虚线缓慢倒流 | `speed=30, direction="reverse"` |
| 静止的工程虚线 | `speed=0, lineCap="butt"` |
| 每段和空隙一样长 | `dashLength=24, gapLength=24` |
| 起点向后错开十像素 | `offset=-10` |

| 程度 | `speed` | `dashLength/gapLength` |
| --- | ---: | --- |
| 轻微 | `20` | `24/18` |
| 中等 | `80` | `32/18` |
| 明显 | `220` | `48/16` |
| 强烈 | `600` | `80/12` |

默认值为示例中的完整 `data`。中性动画值是 `speed=0`、`offset=0`；几何没有完全中性值。工具不适用于实体描边生长、粒子沿路径飞行或多路径连接。路径由服务端绑定，`data` 中不得出现路径、素材或资源标识。

## 服务器输入槽（不进入模型 `data`）

- `source_path`（必需，`data`，单个）：提示词直接生成模式下由服务器创建确定性的默认路径，不要求用户上传素材。模型不得输出路径点、资源身份、文件路径或 URL。
