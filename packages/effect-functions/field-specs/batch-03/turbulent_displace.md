# 湍流置换 `turbulent_displace`

## 工具作用

用服务端 `seed` 驱动的多频分形向量场扭曲服务端绑定图像，产生云涌、热浪和不规则空间扰动。相同上下文与参数必须复现相同结果。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"turbulent_displace","data":{"amount":32,"scale":90,"complexity":3,"evolutionSpeed":0.35,"anisotropy":0,"edgeMode":"mirror"}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `amount` | 数字 `0..240` | `32` | 最大置换量（像素）。 |
| `scale` | 数字 `4..800` | `90` | 噪声空间尺度；越小纹理越碎。 |
| `complexity` | 整数 `1..6` | `3` | 分形层数和细节量。 |
| `evolutionSpeed` | 数字 `-5..5` | `0.35` | 噪声场演化速度；负值反向。 |
| `anisotropy` | 数字 `-1..1` | `0` | 方向偏置；正值偏横向，负值偏纵向。 |
| `edgeMode` | `clamp` / `mirror` / `wrap` | `mirror` | 越界采样方式。 |

## 表达映射与选择顺序

- “更强、更扭曲”先增大 `amount`；“更细碎”减小 `scale`；“更大块”增大 `scale`。
- “细节更多、更复杂”增大 `complexity`；“更快翻涌”增大 `evolutionSpeed` 的绝对值。
- “横向拉扯”提高 `anisotropy`，“纵向拉扯”降低它。
- `scale` 与 `complexity` 都影响细节：先用 `scale` 选大块或细碎，再用 `complexity` 补充分形层次。
- `amount=0` 时不要用复杂度制造假强度；强度请求始终优先改 `amount`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 柔和的大块云涌 | `{"amount":14,"scale":180,"complexity":2,"evolutionSpeed":0.15,"anisotropy":0,"edgeMode":"mirror"}` |
| 常规有机湍流 | `{"amount":32,"scale":90,"complexity":3,"evolutionSpeed":0.35,"anisotropy":0,"edgeMode":"mirror"}` |
| 更细碎、更复杂 | `{"amount":32,"scale":28,"complexity":5,"evolutionSpeed":0.35,"anisotropy":0,"edgeMode":"mirror"}` |
| 强烈横向热浪 | `{"amount":75,"scale":55,"complexity":4,"evolutionSpeed":1.1,"anisotropy":0.65,"edgeMode":"mirror"}` |
| 无缝纹理缓慢反向翻涌 | `{"amount":24,"scale":120,"complexity":3,"evolutionSpeed":-0.2,"anisotropy":0,"edgeMode":"wrap"}` |

## 推荐值、默认值和中性值

自然效果推荐 `amount=15..45`、`scale=60..180`、`complexity=2..4`。默认值为表中数值。中性效果是 `amount=0`。`complexity=5..6` 成本较高，只在明确要求大量细节时使用。

## 不适用范围

不用于规则正弦波、流体折射、几何镜像、数据故障或粒子。模型不得输出 `seed`，也不得输出源图、纹理、资源 ID、路径或 URL。
