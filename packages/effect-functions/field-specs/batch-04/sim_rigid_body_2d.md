# 二维刚体模拟 `sim_rigid_body_2d`

用户已经选中本工具。你只决定圆形刚体群的数量和动力学参数；工具以固定步长执行重力、边界碰撞、刚体间冲量、摩擦和有限次求解。

只输出 JSON，`type` 必须严格为 `sim_rigid_body_2d`。`data` 只能包含下表字段，不输出资源、图层、渲染或导出设置。

合法示例：

```json
{"type":"sim_rigid_body_2d","data":{"bodyCount":20,"gravity":9.8,"restitution":0.7,"friction":0.2,"initialSpeed":1.8,"bodyRadius":0.055,"solverIterations":4}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `bodyCount` | 否 | 整数 2–48，默认 12 | 控制刚体数量和拥挤度 |
| `gravity` | 否 | 0–20，默认 7.5 | 大值更快下坠、更有重量感 |
| `restitution` | 否 | 0–1，默认 0.55 | 0 近乎不反弹，1 接近完全弹性 |
| `friction` | 否 | 0–1，默认 0.25 | 大值更快损失切向速度 |
| `initialSpeed` | 否 | 0–5，默认 1.2 | 控制初始散动和碰撞活跃度 |
| `bodyRadius` | 否 | 0.02–0.15，默认 0.065 | 控制统一圆形碰撞半径 |
| `solverIterations` | 否 | 整数 1–8，默认 3 | 密集或小半径群体可提高，限制在必要范围 |

表达对应：重/轻对应 `gravity`；弹/不弹对应 `restitution`；滑/涩对应 `friction`；猛烈/平静对应 `initialSpeed`；数量对应 `bodyCount`；大块/小块对应 `bodyRadius`。阻尼没有独立字段，摩擦负责接触时的切向衰减。

参数优先级：重量感 > 弹性 > 活跃速度 > 摩擦 > 数量/尺寸 > 求解次数。高数量或密集小刚体时，把 `solverIterations` 设为 5–7。

自然语言示例：

- “沉重落下且几乎不反弹”：`gravity` 15，`restitution` 0.1，`friction` 0.7。
- “像弹力球一样活跃”：`restitution` 0.92，`initialSpeed` 2.5，`friction` 0.05。
- “许多小颗粒碰撞”：`bodyCount` 44，`bodyRadius` 0.025，`solverIterations` 6。
- “少量大块缓慢漂浮”：`bodyCount` 4，`bodyRadius` 0.14，`gravity` 0.5，`initialSpeed` 0.4。
- “无重力台球碰撞”：`gravity` 0，`restitution` 0.8，`friction` 0.15。
- “密集但稳定堆叠”：`bodyCount` 32，`initialSpeed` 0.2，`solverIterations` 7。

推荐档位：`gravity` 轻 0–3 / 中 5–10 / 重 12–18；`restitution` 闷 0–0.25 / 自然 0.4–0.65 / 高弹 0.75–0.95；`initialSpeed` 静 0–0.5 / 中 0.8–2 / 猛烈 2.5–4.5。

中性值与默认行为：默认 12 个中等圆形刚体，在常规重力下有适度反弹与摩擦。用户未指定时不要把求解次数或数量推到上限。

不适用范围：任意多边形或三维刚体、关节、破碎拓扑、真实质量单位、资源或碰撞网格选择。
