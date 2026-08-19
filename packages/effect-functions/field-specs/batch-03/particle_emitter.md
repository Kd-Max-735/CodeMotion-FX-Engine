# 粒子发射器 `particle_emitter`

## 工具作用

在用户上传的图片或视频素材中心持续生成带柔光和高亮核心的粒子，控制速率、初速度、方向、扩散角、生命周期、重力和阻力。粒子纹理由服务端可选绑定；不会把素材替换成黑色背景。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_emitter","data":{"rate":120,"speed":260,"direction":-90,"spread":35,"lifetime":2.2,"size":8,"gravity":180,"drag":0.08}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `rate` | 数字 `1..5000` | `120` | 每秒生成数量。 |
| `speed` | 数字 `0..2000` | `260` | 初始速度（像素/秒）。 |
| `direction` | 数字 `-180..180` | `-90` | 发射中心方向（度）。 |
| `spread` | 数字 `0..180` | `35` | 发射锥角。 |
| `lifetime` | 数字 `0.05..20` | `2.2` | 单粒子寿命（秒）。 |
| `size` | 数字 `0.5..200` | `8` | 粒子尺寸（像素）。 |
| `gravity` | 数字 `-2000..2000` | `180` | 垂直加速度；负值向上。 |
| `drag` | 数字 `0..1` | `0.08` | 速度阻尼。 |

## 表达映射与选择顺序

- “更多、更密”先增大 `rate`；“更快、喷得更远”先增大 `speed`。
- “更散”增大 `spread`；“持续更久”增大 `lifetime`；“更大颗”增大 `size`。
- “下坠更明显”增大 `gravity`；“更轻、更飘”减小 `gravity` 并适度提高 `drag`。
- `rate` 和 `lifetime` 都增加同屏粒子数：说生成更多改 `rate`，说停留更久改 `lifetime`。
- `speed` 和 `spread` 都扩大覆盖范围：说喷远改 `speed`，说扇面更开改 `spread`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 柔和向上喷出的轻雾 | `{"rate":260,"speed":70,"direction":-90,"spread":90,"lifetime":4.5,"size":14,"gravity":-12,"drag":0.2}` |
| 常规粒子喷泉 | `{"rate":120,"speed":260,"direction":-90,"spread":35,"lifetime":2.2,"size":8,"gravity":180,"drag":0.08}` |
| 粒子更多更密 | `{"rate":520,"speed":260,"direction":-90,"spread":35,"lifetime":2.2,"size":8,"gravity":180,"drag":0.08}` |
| 向右高速窄喷流 | `{"rate":420,"speed":720,"direction":0,"spread":12,"lifetime":0.8,"size":4,"gravity":40,"drag":0.02}` |
| 大颗粒向四周散开 | `{"rate":180,"speed":360,"direction":0,"spread":180,"lifetime":1.6,"size":18,"gravity":100,"drag":0.06}` |

## 推荐值、默认值和中性值

常规推荐 `rate=60..400`、`speed=80..600`、`lifetime=0.8..4`。默认值见表。该生成器没有零发射中性值，最弱合法设置为 `rate=1`、`speed=0`、短寿命和小尺寸；不需要粒子时应不调用工具。

## 服务器输入行为

`background_image` 是必需的服务器授权素材帧，可来自图片或逐帧解码的视频；粒子始终合成在该素材上。`particle_texture` 是可选的服务器授权 RGBA 纹理；省略时确定性地使用程序化圆形粒子。素材身份不进入模型参数。

## 不适用范围

不用于 Logo 聚合、目标图溶解、拖尾历史、一次性火花或雨雪。不得输出 `seed`、发射贴图 ID、路径或 URL。
