# 粒子 Logo 聚合 `particle_logo_assemble`

## 工具作用

让散布粒子沿旋涡和吸引场聚合到服务端绑定 Logo 的 Alpha 轮廓。Logo 是服务器授权输入，不属于模型 `data`；随机采样使用服务端 `seed`。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_logo_assemble","data":{"particleCount":2200,"duration":2.4,"scatterRadius":0.8,"swirl":0.45,"attraction":0.72,"damping":0.8,"particleSize":3}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `particleCount` | 整数 `100..50000` | `2200` | 采样 Logo 轮廓的粒子数。 |
| `duration` | 数字 `0.2..15` | `2.4` | 完成聚合所需时间（秒）。 |
| `scatterRadius` | 数字 `0.05..3` | `0.8` | 初始散布半径（画面比例）。 |
| `swirl` | 数字 `-3..3` | `0.45` | 聚合旋转圈数和方向。 |
| `attraction` | 数字 `0.05..2` | `0.72` | 朝目标轮廓的吸引强度。 |
| `damping` | 数字 `0..1` | `0.8` | 接近目标时的速度阻尼。 |
| `particleSize` | 数字 `0.5..30` | `3` | 粒子尺寸（像素）。 |

## 表达映射与选择顺序

- “更多、更细腻”提高 `particleCount`；“更快聚合”优先减小 `duration`。
- “更散”提高 `scatterRadius`；“旋转更多/反向旋转”调整 `swirl` 的绝对值/符号。
- “吸得更强”提高 `attraction`；“更柔和地停住”提高 `damping`。
- `duration` 与 `attraction` 都影响速度：明确时间时先设 `duration`，强调运动力度时再改 `attraction`。
- `particleCount` 与 `particleSize` 都影响 Logo 实心程度：先按细腻度定数量，再用尺寸补足可见度。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 柔和缓慢地聚成 Logo | `{"particleCount":2600,"duration":4,"scatterRadius":0.5,"swirl":0.18,"attraction":0.42,"damping":0.9,"particleSize":3}` |
| 经典粒子 Logo 聚合 | `{"particleCount":2200,"duration":2.4,"scatterRadius":0.8,"swirl":0.45,"attraction":0.72,"damping":0.8,"particleSize":3}` |
| 粒子更多更细腻 | `{"particleCount":8000,"duration":2.4,"scatterRadius":0.8,"swirl":0.45,"attraction":0.72,"damping":0.8,"particleSize":1.5}` |
| 从很散的位置快速汇聚 | `{"particleCount":3000,"duration":1.1,"scatterRadius":2,"swirl":0.3,"attraction":1.5,"damping":0.65,"particleSize":3}` |
| 反向旋涡聚合 | `{"particleCount":4200,"duration":2,"scatterRadius":1.3,"swirl":-1.5,"attraction":1,"damping":0.72,"particleSize":2}` |

## 推荐值、默认值和中性值

常规推荐 `particleCount=1500..6000`、`duration=1.5..4`、`scatterRadius=0.4..1.4`。默认值见表。此效果没有画面中性值；最平静的合法运动是最小散布、`swirl=0`、较高 `damping`。

## 服务器输入行为

`logo_image` 是必需的服务器授权 RGBA 图像。缺失、未锁定、所有者不匹配、尺寸不匹配或没有非透明像素时拒绝；粒子目标点和颜色只从该绑定采样。

## 不适用范围

只适合聚合到单个服务器绑定 Logo；不用于任意多目标变形、Logo 生成、目标图溶解、普通发射或文字排版。不要输出 Logo ID、图像、路径、URL 或 `seed`。
