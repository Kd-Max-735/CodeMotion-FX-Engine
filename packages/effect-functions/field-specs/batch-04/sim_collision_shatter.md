# 碰撞碎裂 `sim_collision_shatter`

用户已经选中本工具。你只决定碎片数量、冲击、扩散角、重力、空气阻力、旋转、反弹和随机性；工具用固定时间步模拟碎片冲量、飞散、旋转和地面碰撞。

只输出 JSON。`type` 必须严格为 `sim_collision_shatter`，`data` 只允许下表字段。`mesh` 与 `fracture_map` 由服务端授权绑定，资源 ID、路径、URL、顶点或破裂图都不能进入模型 `data`。

合法示例：

```json
{"type":"sim_collision_shatter","data":{"fragmentCount":32,"impactStrength":6,"spreadAngle":260,"gravity":9,"drag":0.6,"spin":5,"restitution":0.3,"randomness":0.55}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `fragmentCount` | 否 | 整数 4–64，默认 24 | 控制碎片数量和细碎程度 |
| `impactStrength` | 否 | 0.1–12，默认 4.5 | 控制初始飞散速度和爆发强度 |
| `spreadAngle` | 否 | 10–360 度，默认 220 | 小值定向喷射，大值全向爆裂 |
| `gravity` | 否 | 0–20，默认 8 | 控制碎片下坠速度和重量感 |
| `drag` | 否 | 0–5，默认 0.5 | 控制平移与旋转速度衰减 |
| `spin` | 否 | 0–12，默认 4 | 控制初始角速度范围 |
| `restitution` | 否 | 0–1，默认 0.35 | 控制触地反弹程度 |
| `randomness` | 否 | 0–1，默认 0.45 | 控制碎片速度、方向与大小差异 |

表达对应：猛烈爆炸对应 `impactStrength`；细碎对应 `fragmentCount`；定向破裂对应小 `spreadAngle`；四散对应接近 360；沉重对应高 `gravity`；慢镜般持续飞散对应低 `drag`；翻滚对应 `spin`；落地弹跳对应 `restitution`；整齐/随机对应 `randomness`。

参数优先级：冲击强度 > 扩散方向 > 碎片粗细 > 重力 > 旋转 > 阻力 > 反弹 > 随机性。用户说“强烈但定向”时提高冲击、缩小扩散角，不要用高随机性破坏方向。

自然语言示例：

- “轻微开裂后掉落”：`impactStrength` 1，`fragmentCount` 10，`gravity` 10，`spreadAngle` 60。
- “全方向猛烈爆裂”：`impactStrength` 10，`spreadAngle` 360，`fragmentCount` 48。
- “大块、沉重地坍落”：`fragmentCount` 8，`gravity` 17，`drag` 1.5，`restitution` 0.1。
- “碎片高速旋转飞散”：`spin` 10，`impactStrength` 7，`drag` 0.2。
- “整齐的扇形定向破碎”：`spreadAngle` 90，`randomness` 0.1，`impactStrength` 5。
- “落地后明显弹跳”：`restitution` 0.8，`gravity` 9，`drag` 0.4。

推荐档位：`impactStrength` 轻 0.5–2 / 中 3–6 / 强 7.5–11；`fragmentCount` 大块 4–12 / 中 16–32 / 细碎 40–64；`gravity` 轻 0–4 / 中 6–10 / 重 12–18；`spin` 少 0–2 / 中 3–6 / 强 8–11。

中性值与默认行为：默认 24 个碎片、中等冲击、宽扇形扩散、自然重力、适度旋转和轻微反弹；无服务端破裂图时生成确定性规范碎片中心。

不适用范围：实时断裂拓扑生成、连续碰撞检测、三维网格切割、爆炸烟雾、资源选择。`mesh` 与 `fracture_map` 永远由服务端绑定。
