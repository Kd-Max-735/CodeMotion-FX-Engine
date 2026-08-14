# 主体跟踪智能裁切（smart_crop_animate）

## 工具作用

读取服务端提供的主体框与时间轨迹，为已绑定视频计算连续裁切窗口。模型只决定构图偏好，不生成主体数据、视频 ID 或路径。

## JSON 示例

```json
{"type":"smart_crop_animate","data":{"subjectIndex":0,"targetAspect":"portrait_9_16","padding":1.4,"trackingStrength":0.95,"smoothing":0.8,"leadRoom":0.18}}
```

## 参数字段

| 字段 | 类型与范围 | 默认值 | 推荐值 | 中性值 | 含义 |
| --- | --- | ---: | --- | ---: | --- |
| `subjectIndex` | integer，0–31 | 0 | 0 | 0 | 服务端排序后的主体序号 |
| `targetAspect` | `source` / `portrait_9_16` / `square_1_1` / `landscape_16_9` | `portrait_9_16` | 按交付画幅 | `source` | 输出裁切宽高比 |
| `padding` | number，1–3 | 1.35 | 1.2–1.8 | 1 | 主体周围保留空间 |
| `trackingStrength` | number，0–1 | 0.9 | 0.75–1 | 0 | 跟随主体的程度 |
| `smoothing` | number，0–1 | 0.75 | 0.6–0.9 | 0 | 时间平滑强度 |
| `leadRoom` | number，0–0.5 | 0.15 | 0.1–0.25 | 0 | 沿运动方向预留空间 |

## 选择规则与优先级

平台或画幅词先决定 `targetAspect`；“第二个人”使用 `subjectIndex=1`。快速运动可提高 `leadRoom`，抖动明显提高 `smoothing`，紧贴主体降低 `padding`。优先级：明确主体序号/画幅 > 构图空间要求 > 稳定或灵敏风格 > 默认值。不得编造不存在的主体序号或轨迹。

## 用户表达示例

- “把主角自动裁成竖屏，跟随稳一点。”
- “跟第二个人，输出正方形。”
- “人物跑动时在前方多留空间。”
- “裁得紧一点，但不要抖。”
- “保持原画幅，只轻微跟随主体。”
- “做灵敏的横屏运动跟随。”

## 不适合处理

不用于检测或生成主体信息、手工抠像、替换背景、选择视频文件、静态自由裁切或同时跟随多个未排序主体。
