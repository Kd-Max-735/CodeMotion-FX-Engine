# 群集模拟 `sim_boids`

用户已经选中本工具。你只决定 boid 数量、速度、感知范围、分离、对齐、聚合和边界回转；工具以固定时间步计算确定性的局部邻域 flocking。

只输出 JSON。`type` 必须严格为 `sim_boids`，`data` 只能包含下表字段，不得输出其他工具、资源或说明。

合法示例：

```json
{"type":"sim_boids","data":{"boidCount":56,"maxSpeed":1.5,"perceptionRadius":0.32,"separation":2,"alignment":1.6,"cohesion":1.3,"boundaryForce":2.5}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `boidCount` | 否 | 整数 8–96，默认 36 | 控制群体规模与密度 |
| `maxSpeed` | 否 | 0.1–3，默认 1.1 | 控制个体速度上限 |
| `perceptionRadius` | 否 | 0.05–0.6，默认 0.28 | 控制每个个体考虑邻居的空间范围 |
| `separation` | 否 | 0–5，默认 1.8 | 控制避免拥挤和近距离排斥 |
| `alignment` | 否 | 0–5，默认 1.1 | 控制速度方向趋同 |
| `cohesion` | 否 | 0–5，默认 0.85 | 控制向邻居中心聚合 |
| `boundaryForce` | 否 | 0–5，默认 2.2 | 控制接近边界时回转力度 |

表达对应：快/慢对应 `maxSpeed`；数量/密集对应 `boidCount`；紧密成群对应高 `cohesion`；整齐同步对应高 `alignment`；互相避让对应高 `separation`；反应范围对应 `perceptionRadius`；不撞边对应 `boundaryForce`。本工具没有重力或阻尼参数。

参数优先级：群体形态（分离/对齐/聚合）> 速度 > 感知范围 > 数量 > 边界。不要同时把三种群体权重全部设到最大；这会让意图不清晰。

自然语言示例：

- “整齐迁徙的鸟群”：`alignment` 2.8，`cohesion` 1.5，`separation` 1.2。
- “紧密的鱼群”：`cohesion` 2.6，`perceptionRadius` 0.4，`maxSpeed` 1。
- “躁动、互相躲避的蜂群”：`maxSpeed` 2.5，`separation` 4，`alignment` 0.4。
- “少量个体缓慢漂移”：`boidCount` 12，`maxSpeed` 0.4，`boundaryForce` 1。
- “大群体但保持间距”：`boidCount` 88，`separation` 3，`cohesion` 1.2。
- “只在很近时才反应”：`perceptionRadius` 0.08，保持中等速度。

推荐档位：`maxSpeed` 慢 0.3–0.7 / 中 0.9–1.6 / 快 2–2.8；`cohesion` 松散 0–0.6 / 自然 0.8–1.8 / 紧密 2.2–4；`separation` 拥挤 0.2–1 / 自然 1.4–2.4 / 强避让 3–4.5。

中性值与默认行为：默认 36 个个体，以适中速度形成兼顾避让、对齐和聚合的自然群体。描述不明确时保持三项权重默认比例。

不适用范围：真实动物 AI、路径规划、障碍地图、捕食关系、三维群集、资源选择或外部目标点。
