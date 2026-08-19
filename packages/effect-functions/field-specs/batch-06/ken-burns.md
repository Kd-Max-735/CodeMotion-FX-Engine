# 肯·伯恩斯平移缩放（ken_burns）

## 工具作用

在服务端绑定的静态图片上执行连续裁切中心移动与缩放，形成纪录片常用的平移推拉效果。图片身份不属于 `data`。

## 服务器资源要求与接入状态

- 必需输入槽：`source_image`，一张 owner-authorized、locked 的 `image`；其 binding 必须是 `rgba8-frame-v1` 解码帧，不能用路径、ID 或其他槽资源代替。
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

“推近”令结束缩放大于起始缩放；“拉远”相反；“先推进再拉远”必须使用 `motionMode=push_then_pull`，运行时至少推进到 1.5 倍峰值；“只横移”令两端缩放相等。用户说主体、最亮区域、主体左/右/上/下时使用对应锚点模式；明确画面坐标时使用 `coordinates`。优先级：明确起止位置与倍率 > 时长 > 方向词 > 默认值。素材锚点是确定性像素边界/亮度分析，不是语义目标检测。

## 用户表达示例

- “六秒内慢慢推近人物。”
- “从画面左侧平移到右侧，不要缩放。”
- “先近后远，做纪录片感。”
- “镜头向右上方缓慢移动。”
- “三秒快速推近到 1.4 倍。”
- “保持中心，只做很轻的放大。”

## 不适合处理

不用于视频变速、语义部位识别、生成图片、选择图片路径、三维深度视差或多镜头剪辑。
