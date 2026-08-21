# 分形 `fractal`

## 1. 工具作用

在用户上传的一张基础图片上，递归绘制多层缩小、旋转后的完整原图，形成画面不断出现“自己”的重复、自相似结构。平滑 Mandelbrot 场只用于辅助细节扰动和轻微着色。

## 2. 输出要求

模型只输出 `{ "type": "fractal", "data": { ... } }` JSON。顶层不得有额外字段，`data` 不得有未声明字段，也不要输出说明文字、资源标识或文件位置。

## 3. 合法 JSON 示例

```json
{"type":"fractal","data":{"gridSize":48,"iterations":120,"centerX":-0.5,"centerY":0,"zoom":1,"rotation":0,"speed":0.18,"strength":0.78,"levels":6,"recursionScale":0.62,"rotationStep":12,"insideColor":"#081C15","outsideColor":"#D8F3DC"}}
```

## 4. 参数表

| 参数 | 类型 | 范围/选项 | 默认值 | 选择策略 |
| --- | --- | --- | --- | --- |
| `gridSize` | 整数 | 8–64 | 48 | 控制采样网格精度；渲染时使用双线性采样而非最近邻马赛克 |
| `iterations` | 整数 | 16–256 | 120 | 控制边界细节；与网格共同影响计算量 |
| `centerX` | 数值 | -2.5–1 | -0.5 | 水平观察中心 |
| `centerY` | 数值 | -1.5–1.5 | 0 | 垂直观察中心 |
| `zoom` | 数值 | 0.25–200 | 1 | 越大越深入局部细节 |
| `rotation` | 数值 | -180–180 度 | 0 | 静态旋转视野 |
| `speed` | 数值 | -2–2 | 0.18 | 旋转动画速度，负值反向，设为 0 时静止 |
| `strength` | 数值 | 0–1 | 0.78 | 递归画面混合强度；`0` 保持原图 |
| `levels` | 整数 | 2–10 | 6 | 原图递归嵌套层数；越高越能看到连续缩小的“自己” |
| `recursionScale` | 数值 | 0.35–0.85 | 0.62 | 每一层相对上一层的缩小比例；越小层级间隔越明显 |
| `rotationStep` | 数值 | -90–90 度 | 12 | 每深入一层增加的旋转角度；负值反向 |
| `insideColor` | `#RRGGBB` | 六位十六进制 | `#081C15` | 集合内部颜色 |
| `outsideColor` | `#RRGGBB` | 六位十六进制 | `#D8F3DC` | 逃逸区域颜色 |

`gridSize² × iterations` 不得超过 1048576；当前字段范围恰好把绝对上限限制在该预算内。

## 5. 表达映射

“更多重复/更深递归”提高 `levels`；“层层缩小明显”降低 `recursionScale`；“每层旋转”设置 `rotationStep`；“整体持续旋转”设置 `speed`；“效果明显/强烈”提高 `strength`。`iterations/gridSize/centerX/centerY/zoom/rotation` 只控制辅助 Mandelbrot 细节场，不应替代递归层参数。

## 6. 自然语言例子

- “画面中不断出现缩小后的自己” → `levels` 6–8、`recursionScale` 约 0.55–0.65。
- “递归画面逐层顺时针旋转” → 正 `rotationStep`，约 10–30 度。
- “缓慢旋转的递归隧道” → 小幅正 `speed`。
- “逆时针快速旋转” → 负 `speed`，绝对值约 1–2。
- “边缘更细致” → 提高 `iterations`，再酌情提高 `gridSize`。
- “在图片上做明显分形折射” → `strength` 约 0.75–0.9。
- “深紫与橙色高反差” → 设置 `insideColor` 和 `outsideColor`，不引用调色板。

## 7. 推荐档位

| 档位 | `levels` | `recursionScale` | `rotationStep` |
| --- | ---: | ---: | ---: |
| 清晰重复 | 4 | 0.68 | 0–8 |
| 均衡递归 | 6 | 0.62 | 8–18 |
| 深层隧道 | 8–10 | 0.5–0.58 | 18–40 |

## 8. 默认值与中性行为

默认值为 `levels=6`、`recursionScale=0.62`、`rotationStep=12`、`strength=0.78`，显示六层清晰的原图递归结构并保持轻微连续旋转。明确要求静止时把 `speed` 设为 0；`strength=0` 为保持上传图片不受影响的中性值。

## 9. 不能处理的内容

服务器必须绑定一张 `background_image` 基础图片，递归层只采样这张授权图片；图片身份始终与模型参数分离。不能生成 Julia 集自定义常数、三维分形、外部调色板、文件路径、URL、资源 ID、时间线或其他工具调用。
