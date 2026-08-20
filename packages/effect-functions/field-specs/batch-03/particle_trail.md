# 粒子拖尾 `particle_trail`

## 工具作用

从可控画面位置沿直线、波浪或环绕轨迹持续发射粒子，形成彗星、丝带或电光拖尾。直线和波浪方向始终固定，不会撞到画面边缘后反射改向。起点、方向和颜色由模型的封闭数值字段控制，素材身份仍只由服务器绑定。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_trail","data":{"emissionRate":180,"trailLength":1.2,"speed":220,"width":3,"fade":0.72,"waviness":0.18,"lifetime":1.6,"startX":0.5,"startY":0.5,"trajectory":"linear","direction":-20,"hue":195,"saturation":0.78,"duration":3,"intensity":1}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `emissionRate` | 数字 `1..5000` | `180` | 每秒补充的轨迹粒子数。 |
| `trailLength` | 数字 `0.05..10` | `1.2` | 保留运动历史的秒数。 |
| `speed` | 数字 `0..2000` | `220` | 粒子沿轨迹离开主体的速度。 |
| `width` | 数字 `0.5..30` | `3` | 单粒子尺寸（像素）。 |
| `fade` | 数字 `0..1` | `0.72` | 随年龄衰减强度。 |
| `waviness` | 数字 `0..1` | `0.18` | 横向波动量。 |
| `lifetime` | 数字 `0.05..20` | `1.6` | 单粒子最长寿命（秒）。 |
| `startX` | 数字 `0..1` | `0.5` | 轨迹起点横向位置，`0/1` 对应左/右。 |
| `startY` | 数字 `0..1` | `0.5` | 轨迹起点纵向位置，`0/1` 对应上/下。 |
| `trajectory` | `linear/wave/orbit` | `linear` | 直线、波浪或环绕轨迹。 |
| `direction` | 数字 `-180..180` | `-20` | 直线/波浪前进方向或环绕初始角度。 |
| `hue` | 数字 `0..360` | `195` | 粒子色相角。 |
| `saturation` | 数字 `0..1` | `0.78` | 粒子颜色饱和度；`0` 为白色。 |
| `duration` | 数字 `0.1..30` | `3` | 重复生成拖尾粒子的持续时间（秒）；自然语言中的“拖尾持续/发射 N 秒”优先映射到此字段。 |
| `emissionDuration` | 数字 `0.1..30` | `3` | 旧版参数别名；当 `duration` 保持默认值时仍可控制重复发射时长。 |
| `intensity` | 数字 `0.1..3` | `1` | 拖尾剧烈程度，影响密度和粒子尺寸。 |

## 表达映射与选择顺序

- “拖尾更长”先增大 `trailLength`；“更多、更密”增大 `emissionRate`。
- “更宽”增大 `width`；“更快散开”增大 `speed`；“更曲折”增大 `waviness`。
- “消失更快”增大 `fade` 或减小 `lifetime`；强调渐隐曲线时改 `fade`，强调最长停留时间时改 `lifetime`。
- `trailLength` 与 `lifetime` 共同限制历史窗口，先设置用户明确说出的长度，再确保 `lifetime` 不短于所需观感。
- `emissionRate` 与 `width` 都让拖尾更厚：密度请求改前者，粗细请求改后者。
- 位置先用 `startX/startY`，轨迹形态用 `trajectory`，运动朝向用 `direction`；三者不可互相代替。
- 颜色名称映射到 `hue`，柔和或接近白色时降低 `saturation`。
- “持续拖尾几秒”设置 `duration`，期间持续补充粒子，而不是拉长一轮动画；兼容旧请求时可使用 `emissionDuration`；“更剧烈”提高 `intensity`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 左下向右的紫色波浪拖尾 | `{"emissionRate":300,"trailLength":2.8,"speed":120,"width":3,"fade":0.45,"waviness":0.4,"lifetime":3.2,"startX":0.15,"startY":0.75,"trajectory":"wave","direction":-15,"hue":285,"saturation":0.55,"emissionDuration":5,"intensity":1}` |
| 常规蓝色直线拖尾 | `{"emissionRate":180,"trailLength":1.2,"speed":220,"width":3,"fade":0.72,"waviness":0.18,"lifetime":1.6,"startX":0.5,"startY":0.5,"trajectory":"linear","direction":-20,"hue":195,"saturation":0.78,"emissionDuration":3,"intensity":1}` |
| 从左侧水平向右的红色拖尾 | `{"emissionRate":480,"trailLength":2,"speed":180,"width":2,"fade":0.5,"waviness":0.05,"lifetime":2.5,"startX":0.08,"startY":0.5,"trajectory":"linear","direction":0,"hue":0,"saturation":0.9,"emissionDuration":6,"intensity":1.2}` |
| 短促青色电光 | `{"emissionRate":520,"trailLength":0.55,"speed":620,"width":2,"fade":0.9,"waviness":0.7,"lifetime":0.65,"startX":0.5,"startY":0.5,"trajectory":"linear","direction":-35,"hue":190,"saturation":1,"emissionDuration":1,"intensity":1.5}` |
| 右上白色环形余辉 | `{"emissionRate":240,"trailLength":2,"speed":100,"width":4,"fade":0.35,"waviness":0.2,"lifetime":2.4,"startX":0.75,"startY":0.25,"trajectory":"orbit","direction":90,"hue":210,"saturation":0,"emissionDuration":4,"intensity":0.8}` |

## 推荐值、默认值和中性值

常规推荐 `emissionRate=100..500`、`trailLength=0.5..3`、`width=3..24`。默认值见表。该效果没有完全中性值；最弱合法设置为最短 `trailLength`、最低 `emissionRate`、最小 `width` 和最高 `fade`。

## 服务器输入行为

`source_image` 是必需的服务器授权素材帧，可来自图片或逐帧解码的视频；拖尾始终合成在该素材上。Ark 仅在用户要求特定物体或部位时分析素材并产生 `startX/startY`，无效绑定必须拒绝。

## 不适用范围

不用于没有运动历史的静态发射、一次性火花、雨雪、目标图溶解或运动模糊。主体素材由服务端绑定，不输出资源 ID、路径、URL 或 `seed`。
