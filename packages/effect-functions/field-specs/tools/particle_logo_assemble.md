# 粒子 Logo 聚合 `particle_logo_assemble`

## 工具作用

保留用户上传图片作为背景，但先将自然语言指定的目标物体区域挖空；散布粒子沿旋涡和吸引场回到该物体原位，逐步填回目标区域。未被指定的背景始终保持可见，结束时粒子消失并显示完整原图。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_logo_assemble","data":{"target":"main subject","particleCount":2200,"duration":2.4,"scatterRadius":0.8,"swirl":0.45,"attraction":0.72,"damping":0.8,"particleSize":3}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `target` | 英文短语 `1..80` 字符 | `main subject` | 将用户点名对象翻译成简短、具体的英文视觉名词短语，供 SAM3.1 在图片中选择目标物体。 |
| `particleCount` | 整数 `100..50000` | `2200` | 采样 Logo 轮廓的粒子数。 |
| `duration` | 数字 `0.2..15` | `2.4` | 完成聚合所需时间（秒）。 |
| `scatterRadius` | 数字 `0.05..3` | `0.8` | 初始散布半径（画面比例）。 |
| `swirl` | 数字 `-3..3` | `0.45` | 聚合旋转圈数和方向。 |
| `attraction` | 数字 `0.05..2` | `0.72` | 朝目标轮廓的吸引强度。 |
| `damping` | 数字 `0..1` | `0.8` | 接近目标时的速度阻尼。 |
| `particleSize` | 数字 `0.5..30` | `3` | 粒子尺寸（像素）。 |

## 表达映射与选择顺序

- 先把用户指定对象翻译成不含动作、材质或资源信息的简短英文 `target`，再设置粒子参数。
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

`logo_image` 是必需的服务器授权 RGBA 图像；服务端使用 SAM3.1 根据 `target` 派生 `subject_mask`，粒子目标点和颜色只从该遮罩区域采样。聚合起始帧保留整张原图但清空目标区域，聚合过程中目标区域由粒子逐渐填回；结束帧显示完整原图且粒子透明度为零。素材身份和 mask 不进入模型参数。

## 不适用范围

只适合聚合到单个服务器绑定 Logo；不用于任意多目标变形、Logo 生成、目标图溶解、普通发射或文字排版。不要输出 Logo ID、图像、路径、URL 或 `seed`。
