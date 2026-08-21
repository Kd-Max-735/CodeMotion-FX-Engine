# 火花粒子 `particle_spark`

## 工具作用

在用户上传的图片或视频素材的指定位置持续产生多轮短寿命火花。起点由服务端图像理解结果写入归一化坐标，方向使用角度制，颜色、剧烈程度、重复间隔和持续发射时间均可控制。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_spark","data":{"count":180,"speed":680,"spread":360,"lifetime":0.65,"gravity":520,"glow":1.4,"size":3,"burstInterval":0.75,"centerX":0.5,"centerY":0.5,"direction":0,"emissionDuration":3,"intensity":1,"color":"#ffb030"}}
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
| `burstInterval` | 数字 `0.1..10` | `0.75` | 相邻两次爆发的间隔秒数。 |
| `centerX` | 数字 `0..1` | `0.5` | 发射中心横向坐标；由图像理解定位。 |
| `centerY` | 数字 `0..1` | `0.5` | 发射中心纵向坐标；由图像理解定位。 |
| `direction` | 数字 `-180..180` | `0` | 发射中心方向角；`0/90/-90/180` 分别为右/下/上/左。 |
| `emissionDuration` | 数字 `0.1..30` | `3` | 重复发射持续时间（秒），不是拉长单轮爆发。 |
| `intensity` | 数字 `0.1..3` | `1` | 发射剧烈程度，同时影响数量和速度。 |
| `color` | `#RRGGBB` | `#ffb030` | 火花颜色。 |

## 表达映射与选择顺序

- “更多火花”增大 `count`；“飞得更快更远”增大 `speed`。
- “更散”增大 `spread`；“更集中、朝一个扇面”减小它。
- “更久”增大 `lifetime`；“下坠更快”增大 `gravity`；“更亮”增大 `glow`。
- `count` 与 `glow` 都增强冲击感：数量请求改 `count`，亮度请求改 `glow`。
- `speed` 与 `lifetime` 都影响飞行距离：力度优先 `speed`，持续时间优先 `lifetime`。
- “持续几秒发射”设置 `emissionDuration`；“更密集/间隔更久”减小/增大 `burstInterval`，期间自动重复多轮。
- “从某物体/部位发出”使用图像理解得到的 `centerX/centerY`；方向词映射为 `direction` 角度。
- “更剧烈”提高 `intensity`；颜色名称转换为 `color`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 中心零星微弱火花 | `{"count":42,"speed":180,"spread":360,"lifetime":1.1,"gravity":120,"glow":0.8,"size":2,"burstInterval":0.55,"centerX":0.5,"centerY":0.5,"direction":0,"emissionDuration":3,"intensity":0.5,"color":"#ffd070"}` |
| 右侧单次冲击火花 | `{"count":180,"speed":680,"spread":360,"lifetime":0.65,"gravity":520,"glow":1.4,"size":3,"burstInterval":0.75,"centerX":0.8,"centerY":0.5,"direction":0,"emissionDuration":0.1,"intensity":1,"color":"#ffb030"}` |
| 从车头向车尾持续五秒 | `{"count":240,"speed":900,"spread":50,"lifetime":0.55,"gravity":400,"glow":1.8,"size":2.5,"burstInterval":0.45,"centerX":0.2,"centerY":0.55,"direction":0,"emissionDuration":5,"intensity":1.3,"color":"#ffd040"}` |
| 向左上持续蓝色飞溅 | `{"count":220,"speed":760,"spread":70,"lifetime":0.8,"gravity":100,"glow":2.2,"size":2,"burstInterval":0.5,"centerX":0.7,"centerY":0.7,"direction":-135,"emissionDuration":4,"intensity":1.2,"color":"#40a8ff"}` |

## 推荐值、默认值和中性值

常规推荐 `count=60..500`、`speed=300..1200`、`lifetime=0.2..1.2`。默认值见表。没有完全中性值；最低可见设置是 `count=1`、`speed=0`、`glow=0` 和最小尺寸。

## 服务器输入行为

`background_image` 是必需的服务器授权素材帧，可来自图片或逐帧解码的视频，火花作为覆盖层合成在其上。Ark 仅对需要定位的描述分析该帧并产生 `centerX/centerY`；素材身份不进入模型参数。

## 不适用范围

不用于持续发射、长拖尾、Logo 聚合、目标图溶解或天气。不得输出 `seed`；本工具也不接受素材 ID、路径或 URL。
