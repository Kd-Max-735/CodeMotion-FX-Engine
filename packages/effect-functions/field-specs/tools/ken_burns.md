# 肯·伯恩斯平移缩放（ken_burns）

## 工具作用

在服务端绑定的静态图片上执行连续裁切中心移动与缩放，形成纪录片常用的平移推拉效果。图片身份不属于 `data`。

## 服务器资源要求与接入状态

- 必需输入槽：`source_image`，一张 owner-authorized、locked 的 `image`；其 binding 必须是 `rgba8-frame-v1` 解码帧，不能用路径、ID 或其他槽资源代替。仅在用户要求对可见主体或部位定位时，同一个服务端 Ark 模型会临时查看这张已校验图片并输出归一化坐标；图片身份、字节、路径和 URL 仍不进入工具 `data`。
- 接入状态：**PASS**。当前确定性 `server-cpu` `render` 会按服务器 `context.time` 对 RGBA 像素执行连续裁切和平移缩放，输出同尺寸 `rgba8-frame-v1` 视频帧；逐像素双线性采样诚实标记为 `heavy`。

## JSON 示例

```json
{"type":"ken_burns","data":{"startTime":0,"duration":6,"startScale":1,"endScale":1.25,"startCenterX":0.4,"startCenterY":0.5,"endCenterX":0.6,"endCenterY":0.42,"startCenterMode":"coordinates","endCenterMode":"subject_center","easing":"ease_in_out","motionMode":"single"}}
```

## 参数字段

| 字段 | 类型与范围 | 默认值 | 推荐值 | 中性值 | 含义 |
| --- | --- | ---: | --- | ---: | --- |
| `startTime` | number，0–3600 秒 | 0 | 0–5 | 0 | 动画开始时间 |
| `duration` | number，>0–120 秒 | 5 | 3–10 | 5 | 平移缩放时长 |
| `startScale` | number，1–4 | 1 | 1–1.4 | 1 | 起始缩放 |
| `endScale` | number，1–4 | 1.18 | 1–1.4 | 1 | 结束缩放 |
| `startCenterX/Y` | number，各 0–1 | 0.5 / 0.5 | 0.25–0.75 | 0.5 | 起始裁切中心 |
| `endCenterX/Y` | number，各 0–1 | 0.55 / 0.45 | 0.25–0.75 | 0.5 | 结束裁切中心 |
| `startCenterMode` / `endCenterMode` | 锚点枚举 | `coordinates` | 按描述 | `coordinates` | 坐标、主体边界/中心或最亮区域；非坐标模式时对应 X/Y 仅作后备值 |
| `easing` | 四种标准缓动 | `ease_in_out` | `ease_in_out` | `linear` | 运动节奏 |
| `motionMode` | `single` / `push_then_pull` | `single` | 按描述 | `single` | 单段运动，或先推进到峰值再拉远 |

## 选择规则与优先级

“推近”令结束缩放大于起始缩放；“拉远”相反；“先推进再拉远”必须使用 `motionMode=push_then_pull`，运行时至少推进到 1.5 倍峰值；“只横移”令两端缩放相等。用户只说主体、最亮区域、主体左/右/上/下且没有指明具体对象时，可使用对应锚点模式。

当用户点名图片中可见的对象或部位，例如“人物的眼睛”“汽车车头”“右侧建筑的招牌”，必须检查随本工具附带的图片，估计该目标视觉中心在整张图片中的位置，并令目标端 `CenterMode=coordinates`、对应 `CenterX/Y` 为归一化坐标；左上为 `[0,0]`，右下为 `[1,1]`。推近某部位通常保留起点为当前全景中心，把 `endCenterX/Y` 设为目标中心；从某部位拉远则把 `startCenterX/Y` 设为目标中心，终点回到用户要求的全景中心。不要仅凭“左、中、右”等粗略词替代图片中可辨认目标的实际位置；目标不可见或有多个同名目标且用户没有限定时，保留最合理的全局锚点，不虚构精确坐标。

优先级：图像中明确命名的目标与起止位置 > 明确倍率 > 时长 > 方向词 > 默认值。

## 用户表达示例

- “六秒内慢慢推近人物的眼睛。”
- “从画面左侧平移到右侧，不要缩放。”
- “先近后远，做纪录片感。”
- “镜头向右上方缓慢移动。”
- “三秒快速推近到 1.4 倍。”
- “保持中心，只做很轻的放大。”

## 不适合处理

不用于视频变速、生成图片、选择图片路径、三维深度视差或多镜头剪辑。只有图片中实际可见的对象或部位才能用于语义定位；遮挡、画外内容和无法区分的同名目标不能保证精确坐标。
