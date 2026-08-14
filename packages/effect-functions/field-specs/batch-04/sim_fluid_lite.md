# 轻量流体 `sim_fluid_lite`

用户已经选中本工具。你只决定二维轻量网格流体的分辨率、黏度、密度扩散、涡量、注入、浮力和压力迭代；工具以固定时间步执行扩散、旋度作用和压力投影。

只输出 JSON。`type` 必须严格等于 `sim_fluid_lite`，`data` 只允许下表字段。`obstacle_mask` 由服务端绑定，不得输出任何 mask、资源 ID、路径或 URL。

合法示例：

```json
{"type":"sim_fluid_lite","data":{"gridSize":18,"viscosity":0.03,"densityDiffusion":0.02,"vorticity":2.2,"injectionStrength":5,"buoyancy":1.5,"pressureIterations":5}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `gridSize` | 否 | 整数 8–24，默认 16 | 每边网格数；越大越细腻、计算越重 |
| `viscosity` | 否 | 0–0.2，默认 0.025 | 大值速度扩散更强、流动更黏 |
| `densityDiffusion` | 否 | 0–0.2，默认 0.018 | 大值密度更快摊开、边缘更软 |
| `vorticity` | 否 | 0–6，默认 1.4 | 控制旋涡与卷曲强度 |
| `injectionStrength` | 否 | 0–10，默认 4.5 | 控制持续注入密度和初始动量 |
| `buoyancy` | 否 | 0–5，默认 1.2 | 控制高密度区域向上运动的倾向 |
| `pressureIterations` | 否 | 整数 1–8，默认 4 | 高涡量或高分辨率时提高投影稳定性 |

表达对应：黏稠对应高 `viscosity`；烟雾散开对应高 `densityDiffusion`；卷曲/旋涡对应 `vorticity`；浓/强注入对应 `injectionStrength`；快速上升对应 `buoyancy`；细节对应 `gridSize`。数量概念在这里对应网格尺寸，不是粒子数量；重力用浮力趋势表达，不要虚构重力字段。

参数优先级：介质类型（黏度/扩散）> 涡旋 > 注入浓度 > 上升趋势 > 分辨率 > 压力迭代。`gridSize` 大于 20 或 `vorticity` 大于 4 时使用 6–8 次压力迭代。

自然语言示例：

- “缓慢上升的柔和烟雾”：`buoyancy` 2.5，`densityDiffusion` 0.04，`vorticity` 0.8。
- “浓稠墨水在水中扩散”：`viscosity` 0.09，`injectionStrength` 8，`densityDiffusion` 0.012。
- “强烈卷曲的旋涡”：`vorticity` 5，`viscosity` 0.008，`pressureIterations` 7。
- “淡而快速消散”：`injectionStrength` 1.5，`densityDiffusion` 0.12。
- “几乎不上升的厚重液体”：`buoyancy` 0.1，`viscosity` 0.16。
- “高细节稳定烟流”：`gridSize` 24，`vorticity` 2，`pressureIterations` 8。

推荐档位：`viscosity` 清稀 0–0.02 / 中 0.03–0.08 / 黏稠 0.1–0.18；`vorticity` 平稳 0–0.8 / 自然 1–2.5 / 强旋 3.5–5.5；`injectionStrength` 淡 1–3 / 中 4–6 / 浓 7–9。

中性值与默认行为：默认 16×16 网格、低黏度、轻扩散、中等注入与轻微上升，兼顾稳定性和成本。

不适用范围：高精度 Navier–Stokes、三维体积流体、液面、真实单位标定、mask 选择或生成。障碍 mask 只由服务端绑定。
