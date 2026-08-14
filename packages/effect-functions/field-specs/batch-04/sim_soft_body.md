# 软体模拟 `sim_soft_body`

用户已经选中本工具。你只决定软体边界节点、弹性、内部压力、阻尼和重力；工具以固定时间步和有限约束迭代模拟可压缩的二维软体。

只输出 JSON。`type` 必须严格等于 `sim_soft_body`，`data` 只能含下表参数。`mesh` 由服务端授权绑定，绝不能输出到模型 `data`。

合法示例：

```json
{"type":"sim_soft_body","data":{"nodeCount":24,"shapeRadius":0.48,"stiffness":36,"pressure":4.2,"damping":2,"gravity":5,"solverIterations":4}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `nodeCount` | 否 | 整数 8–48，默认 20 | 控制边界离散精度和计算量 |
| `shapeRadius` | 否 | 0.15–0.75，默认 0.42 | 无绑定网格时控制规范软体尺寸，也是压力目标半径 |
| `stiffness` | 否 | 5–100，默认 42 | 大值保持边界长度，小值更容易形变 |
| `pressure` | 否 | 0–10，默认 3.5 | 大值更饱满并抗压，0 会明显塌缩 |
| `damping` | 否 | 0.1–8，默认 2.2 | 控制形变振荡的消退速度 |
| `gravity` | 否 | 0–20，默认 3 | 控制下坠与接触地面的重量感 |
| `solverIterations` | 否 | 整数 1–6，默认 3 | 高刚度或高压力时提高稳定性 |

表达对应：果冻感对应低中 `stiffness`、中高 `pressure`、低阻尼；橡胶感对应高 `stiffness` 和中阻尼；扁/泄气对应低 `pressure`；饱满对应高 `pressure`；沉重对应 `gravity`；细腻轮廓对应 `nodeCount`。

参数优先级：软硬 > 饱满度 > 重量 > 阻尼 > 尺寸 > 节点数。`stiffness` 超过 70 或 `pressure` 超过 7 时优先用 4–6 次求解。

自然语言示例：

- “柔软抖动的果冻”：`stiffness` 16，`pressure` 5.5，`damping` 1。
- “紧实的橡胶球”：`stiffness` 82，`pressure` 3，`damping` 4，`solverIterations` 5。
- “泄气并向下塌”：`pressure` 0.4，`gravity` 10，`stiffness` 22。
- “大而轻的软泡”：`shapeRadius` 0.7，`gravity` 0.8，`pressure` 6。
- “轮廓细密但运动克制”：`nodeCount` 44，`damping` 6，`stiffness` 55。
- “无重力持续晃动”：`gravity` 0，`damping` 0.5，`stiffness` 28。

推荐档位：`stiffness` 软 8–25 / 中 30–60 / 硬 70–95；`pressure` 塌 0–1.5 / 自然 2.5–5 / 饱满 6–9；`damping` 弹动 0.3–1.5 / 自然 2–4 / 克制 5–7。

中性值与默认行为：默认 20 节点、中等尺寸、中等弹性和压力、轻重力；没有服务端网格时生成规范环形边界。

不适用范围：三维有限元、真实体积材料、布料或绳索拓扑、资源选择。`mesh` 的 ID、路径和顶点数据都不由模型输出。
