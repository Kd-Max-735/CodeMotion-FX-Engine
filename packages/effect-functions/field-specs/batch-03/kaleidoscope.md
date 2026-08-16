# 万花筒 `kaleidoscope`

## 工具作用

围绕指定中心把服务端绑定图像转换到极坐标，折叠为重复或交替镜像扇区，并按时间旋转形成几何对称图案。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"kaleidoscope","data":{"segments":8,"rotation":0,"centerX":0.5,"centerY":0.5,"zoom":1,"mirror":true,"rotationSpeed":15}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `segments` | 整数 `2..32` | `8` | 扇区数量；越大花瓣越密。 |
| `rotation` | 数字 `-360..360` | `0` | 图案旋转角度（度）。 |
| `centerX` | 数字 `0..1` | `0.5` | 中心水平位置。 |
| `centerY` | 数字 `0..1` | `0.5` | 中心垂直位置。 |
| `zoom` | 数字 `0.25..4` | `1` | 源图采样缩放。 |
| `mirror` | 布尔值 | `true` | 是否交替镜像相邻扇区。 |
| `rotationSpeed` | 数字 `-360..360` | `15` | 每秒旋转角度；负值反向，`0` 为静止。 |

## 表达映射与选择顺序

- “更多花瓣、更密”提高 `segments`；“更简洁”降低它。
- “旋转一点”改 `rotation`；“旋转更快/反向”改 `rotationSpeed` 的绝对值/符号；“中心偏左/右/上/下”分别改 `centerX/centerY`。
- “放大图案、看局部”提高 `zoom`；“重复而不镜像”设 `mirror=false`。
- `segments` 与 `zoom` 都会增加视觉密度：明确说花瓣数量时只改 `segments`，明确说放大或细节时改 `zoom`。
- 位置请求先改中心，构图角度请求再改 `rotation`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 简洁四向镜像 | `{"segments":4,"rotation":0,"centerX":0.5,"centerY":0.5,"zoom":1.2,"mirror":true,"rotationSpeed":8}` |
| 经典八瓣万花筒 | `{"segments":8,"rotation":0,"centerX":0.5,"centerY":0.5,"zoom":1,"mirror":true,"rotationSpeed":15}` |
| 更多更密的水晶花 | `{"segments":16,"rotation":22.5,"centerX":0.5,"centerY":0.5,"zoom":1.65,"mirror":true,"rotationSpeed":28}` |
| 中心偏左并顺时针旋转 | `{"segments":8,"rotation":35,"centerX":0.3,"centerY":0.5,"zoom":1,"mirror":true,"rotationSpeed":35}` |
| 六段重复但不要镜像 | `{"segments":6,"rotation":0,"centerX":0.5,"centerY":0.5,"zoom":1,"mirror":false,"rotationSpeed":0}` |

## 推荐值、默认值和中性值

常用 `segments=4..12`、`zoom=0.8..1.8`、`rotationSpeed=-45..45`；默认值见表。该效果没有严格的画面中性值，最弱结构为 `segments=2`、`mirror=false`、`rotation=0`、`rotationSpeed=0`、中心居中、`zoom=1`，仍会产生重复折叠。

## 服务器输入行为

`primary_image` 是必需的服务器授权图像；缺失、未锁定、租户不匹配或尺寸不匹配时必须在渲染前拒绝。模型不得输出该输入的身份。

## 不适用范围

不用于普通旋转、规则波浪、湍流、液态折射或无对称要求的裁剪。源图由服务端绑定，不输出资源 ID、路径或 URL。
