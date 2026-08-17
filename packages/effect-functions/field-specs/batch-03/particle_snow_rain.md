# 雨雪粒子 `particle_snow_rain`

## 工具作用

在用户上传的服务器授权背景图上生成具有远近层次的持续降雪或降雨覆盖。雪使用带柔光的飘动薄片，雨使用顺着速度方向拉伸的运动条纹。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_snow_rain","data":{"mode":"snow","density":0.55,"fallSpeed":180,"wind":20,"turbulence":0.35,"size":5,"depth":0.7,"opacity":0.85}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `mode` | `snow` / `rain` | `snow` | 天气粒子形态。 |
| `density` | 数字 `0.01..1` | `0.55` | 覆盖密度。 |
| `fallSpeed` | 数字 `10..2000` | `180` | 下落速度（像素/秒）。 |
| `wind` | 数字 `-800..800` | `20` | 水平风速；正值向右。 |
| `turbulence` | 数字 `0..1` | `0.35` | 横向随机摆动。 |
| `size` | 数字 `0.5..50` | `5` | 雪片或雨线宽度基准。 |
| `depth` | 数字 `0..1` | `0.7` | 远近速度与尺寸层次。 |
| `opacity` | 数字 `0..1` | `0.85` | 总体不透明度。 |

## 表达映射与选择顺序

- “下雪/下雨”先设置 `mode`；“更多、更密”提高 `density`。
- “更快、更急”提高 `fallSpeed`；“风更大/向左”调整 `wind` 的绝对值/符号。
- “雪更飘”提高 `turbulence`；雨通常保持较低值。
- “更有纵深”提高 `depth`；“更柔和”降低 `opacity`，并可减小 `size`。
- `density` 与 `opacity` 都影响遮挡感：数量请求先改 `density`，透明柔和请求改 `opacity`。
- 雨雪形态冲突时 `mode` 优先；切换到雨后应提高 `fallSpeed`、降低 `turbulence` 和 `size`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 轻柔飘雪 | `{"mode":"snow","density":0.35,"fallSpeed":110,"wind":10,"turbulence":0.45,"size":4,"depth":0.65,"opacity":0.72}` |
| 常规下雪 | `{"mode":"snow","density":0.55,"fallSpeed":180,"wind":20,"turbulence":0.35,"size":5,"depth":0.7,"opacity":0.85}` |
| 更密更大的雪 | `{"mode":"snow","density":0.85,"fallSpeed":220,"wind":30,"turbulence":0.5,"size":9,"depth":0.8,"opacity":0.9}` |
| 向右的暴风雪 | `{"mode":"snow","density":0.92,"fallSpeed":420,"wind":360,"turbulence":0.8,"size":7,"depth":1,"opacity":0.9}` |
| 急雨但不要太遮挡 | `{"mode":"rain","density":0.78,"fallSpeed":1100,"wind":85,"turbulence":0.08,"size":2,"depth":0.85,"opacity":0.58}` |
| 向左的细雨 | `{"mode":"rain","density":0.3,"fallSpeed":620,"wind":-120,"turbulence":0.04,"size":1,"depth":0.5,"opacity":0.45}` |

## 推荐值、默认值和中性值

雪推荐 `fallSpeed=80..350`、`turbulence=0.2..0.7`、`size=3..10`；雨推荐 `fallSpeed=500..1400`、`turbulence=0..0.15`、`size=0.8..3`。默认值见表。无完全中性值；最弱合法覆盖为 `density=0.01`、`opacity=0`。

## 服务器输入行为

`background_image` 是必需的服务器授权背景图。雨雪只作为覆盖层合成在该图像上，素材身份不进入模型参数；空间分布只由服务器 `seed` 决定。

## 不适用范围

不用于真实天气模拟、积雪/积水、闪电、雾、单次火花或目标素材变形。不得输出 `seed`、背景素材、资源 ID、路径或 URL。
