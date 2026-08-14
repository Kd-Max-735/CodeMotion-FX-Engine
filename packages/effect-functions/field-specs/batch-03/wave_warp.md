# 波浪扭曲 `wave_warp`

## 工具作用

对服务端绑定的源图执行单轴正弦坐标置换，适合旗帜摆动、水波和规则波纹。源图由服务端授权绑定，不属于模型参数。

## JSON 输出格式

只输出 JSON，不附加说明或代码块：

```json
{"type":"wave_warp","data":{"amplitude":24,"frequency":2,"axis":"x","phase":0,"speed":0.5,"edgeMode":"mirror"}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `amplitude` | 数字 `0..240` | `24` | 波峰位移像素，决定扭曲强度。 |
| `frequency` | 数字 `0.1..20` | `2` | 画面内波的密度。 |
| `axis` | `x` / `y` | `x` | `x` 横向位移，`y` 纵向位移。 |
| `phase` | 数字 `-6.2832..6.2832` | `0` | 波形起始相位。 |
| `speed` | 数字 `-8..8` | `0.5` | 波形运动速度；负值反向。 |
| `edgeMode` | `clamp` / `mirror` / `wrap` | `mirror` | 越界采样方式。 |

## 表达映射与选择顺序

- “更强、摆幅更大”先增大 `amplitude`；“波更多、更密”增大 `frequency`。
- “更快”增大 `speed` 的绝对值；“反向”改变 `speed` 符号。
- “横向摆动/纵向起伏”分别选 `axis=x/y`；“换一个起始波形”改 `phase`。
- `amplitude` 与 `frequency` 都能让画面更活跃，优先按“幅度”改前者，按“密度”改后者；未说明时只改 `amplitude`。
- 一般图像用 `mirror`，无缝纹理用 `wrap`，要求边缘固定时用 `clamp`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 轻微的横向水波 | `{"amplitude":8,"frequency":1.5,"axis":"x","phase":0,"speed":0.25,"edgeMode":"mirror"}` |
| 像旗帜一样缓慢摆动 | `{"amplitude":24,"frequency":2,"axis":"x","phase":0,"speed":0.35,"edgeMode":"mirror"}` |
| 波纹更密更快 | `{"amplitude":24,"frequency":6,"axis":"x","phase":0,"speed":1.4,"edgeMode":"mirror"}` |
| 纵向强烈起伏 | `{"amplitude":70,"frequency":3,"axis":"y","phase":0,"speed":0.8,"edgeMode":"mirror"}` |
| 无缝纹理反向流动 | `{"amplitude":18,"frequency":4,"axis":"x","phase":1.57,"speed":-0.7,"edgeMode":"wrap"}` |

## 推荐值、默认值和中性值

轻柔推荐 `amplitude=6..14`、`frequency=1..2`；常规使用默认值；强烈推荐 `amplitude=40..80`、`frequency=3..7`。默认值如示例所示。中性效果是 `amplitude=0`，此时其他字段不改变画面。

## 不适用范围

不用于随机湍流、液态折射、万花筒镜像、粒子、转场或局部蒙版变形；这些请求不要硬映射到本工具。不要输出源图 ID、路径、URL 或 `seed`。
