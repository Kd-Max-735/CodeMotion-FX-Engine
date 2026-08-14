# 火花粒子 `particle_spark`

## 工具作用

在时间零产生一次短寿命冲击爆发，使用服务端 `seed` 确定方向与速度差异，适合碰撞、砂轮和电火花。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_spark","data":{"count":180,"speed":680,"spread":360,"lifetime":0.65,"gravity":520,"glow":1.4,"size":3}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `count` | 整数 `1..10000` | `180` | 单次爆发粒子数。 |
| `speed` | 数字 `0..3000` | `680` | 初速度（像素/秒）。 |
| `spread` | 数字 `1..360` | `360` | 爆发角范围（度）。 |
| `lifetime` | 数字 `0.02..5` | `0.65` | 火花寿命（秒）。 |
| `gravity` | 数字 `-2000..3000` | `520` | 垂直加速度。 |
| `glow` | 数字 `0..5` | `1.4` | 发光亮度。 |
| `size` | 数字 `0.2..30` | `3` | 火花尺寸（像素）。 |

## 表达映射与选择顺序

- “更多火花”增大 `count`；“飞得更快更远”增大 `speed`。
- “更散”增大 `spread`；“更集中、朝一个扇面”减小它。
- “更久”增大 `lifetime`；“下坠更快”增大 `gravity`；“更亮”增大 `glow`。
- `count` 与 `glow` 都增强冲击感：数量请求改 `count`，亮度请求改 `glow`。
- `speed` 与 `lifetime` 都影响飞行距离：力度优先 `speed`，持续时间优先 `lifetime`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 零星微弱火花 | `{"count":42,"speed":180,"spread":360,"lifetime":1.1,"gravity":120,"glow":0.8,"size":2}` |
| 常规冲击火花 | `{"count":180,"speed":680,"spread":360,"lifetime":0.65,"gravity":520,"glow":1.4,"size":3}` |
| 更多更亮的爆发 | `{"count":650,"speed":760,"spread":360,"lifetime":0.8,"gravity":520,"glow":2.8,"size":3}` |
| 集中向右飞溅 | `{"count":240,"speed":900,"spread":50,"lifetime":0.55,"gravity":400,"glow":1.8,"size":2.5}` |
| 砂轮高速细火花 | `{"count":680,"speed":1250,"spread":95,"lifetime":0.42,"gravity":900,"glow":2.2,"size":1.5}` |

## 推荐值、默认值和中性值

常规推荐 `count=60..500`、`speed=300..1200`、`lifetime=0.2..1.2`。默认值见表。没有完全中性值；最低可见设置是 `count=1`、`speed=0`、`glow=0` 和最小尺寸。

## 不适用范围

不用于持续发射、长拖尾、Logo 聚合、目标图溶解或天气。不得输出 `seed`；本工具也不接受素材 ID、路径或 URL。
