# 粒子流场 `particle_flow_field`

用户已经选中本工具。你只决定参数值；工具会以固定时间步将高密度发光粒子沿程序化或服务端绑定的二维矢量场推进，并以粒子亮芯、柔光和短速度拖尾呈现连续流动。

只输出 JSON，不要输出说明或代码围栏。`type` 必须严格为 `particle_flow_field`，`data` 不得有表外字段。`vector_field` 由服务端授权绑定，不得放入模型 `data`。

合法示例：

```json
{"type":"particle_flow_field","data":{"particleCount":72,"fieldStrength":3.2,"fieldScale":1.8,"turbulence":0.6,"drag":0.8,"advectionSpeed":1.6,"spawnRadius":0.75}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `particleCount` | 否 | 整数 32–512，默认 180 | 控制发光粒子密度和计算量 |
| `fieldStrength` | 否 | 0.1–6，默认 1.8 | 控制矢量场对速度的推动力度 |
| `fieldScale` | 否 | 0.25–4，默认 1.2 | 大值产生更细碎、更频繁转向的场结构 |
| `turbulence` | 否 | 0–2，默认 0.35 | 增加局部扰动，不等同于整体速度 |
| `drag` | 否 | 0–5，默认 1.1 | 大值抑制惯性并使流动更稳定 |
| `advectionSpeed` | 否 | 0.1–3，默认 1 | 控制沿场推进的整体时间速度 |
| `spawnRadius` | 否 | 0.1–1，默认 0.8 | 控制粒子初始分布范围 |

表达对应：强风/强流对应 `fieldStrength`；快慢对应 `advectionSpeed`；凌乱/湍急对应 `turbulence`；层流/平滑对应低 `turbulence` 与较高 `drag`；密度对应 `particleCount`；局部纹理细密对应提高 `fieldScale`。本工具没有重力字段。

参数优先级：整体速度 > 场力度 > 湍流程度 > 阻力 > 空间尺度 > 数量。不要用 `fieldScale` 代替速度，也不要仅提高 `turbulence` 来表达强流。

自然语言示例：

- “平稳的慢速层流”：`advectionSpeed` 0.5，`turbulence` 0.05，`drag` 2。
- “强劲快速的阵风”：`fieldStrength` 4，`advectionSpeed` 2.2，`drag` 0.7。
- “细碎而混乱的湍流”：`fieldScale` 2.8，`turbulence` 1.5。
- “大范围稀疏漂流”：`particleCount` 48，`spawnRadius` 1，`fieldStrength` 1。
- “密集但方向稳定”：`particleCount` 320，`turbulence` 0.1，`drag` 2.4。
- “集中从中心散开”：`spawnRadius` 0.2，`fieldStrength` 2.5，`advectionSpeed` 1.4。

推荐档位：`fieldStrength` 弱 0.5–1.2 / 中 1.5–3 / 强 3.5–5.5；`advectionSpeed` 慢 0.3–0.7 / 中 0.9–1.5 / 快 1.8–2.8；`turbulence` 平稳 0–0.2 / 活跃 0.35–0.8 / 混乱 1.1–1.8。

中性值与默认行为：默认生成 180 个发光粒子、适中推进和轻微湍动；未提及的维度保持默认，避免把所有参数同时推高。

不适用范围：流体体积守恒、烟雾密度、刚体碰撞、三维风场、路径或资源选择。精确 `vector_field` 由服务端绑定。
