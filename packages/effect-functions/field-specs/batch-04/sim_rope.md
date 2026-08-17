# 绳索模拟 `sim_rope`

用户已经选中本工具。你只决定绳索分段、长度、重力、阻尼、约束刚度、初始摆动和锚定方式；工具用固定步长 Verlet 积分与有限距离约束模拟绳索，并在用户图像上合成有阴影、粗细、纤维高光和金属锚点的编织绳体。

只输出 JSON，`type` 必须严格为 `sim_rope`。`data` 只能包含下表字段。`source_image` 与锚点 `pins` 由服务端授权绑定，不得输出到模型 `data`。

合法示例：

```json
{"type":"sim_rope","data":{"segmentCount":24,"ropeLength":1.5,"gravity":8,"damping":0.03,"stiffness":0.9,"swingImpulse":2.5,"solverIterations":6,"anchorMode":"start"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `segmentCount` | 否 | 整数 6–40，默认 18 | 越大曲线越细腻，不直接改变总长度 |
| `ropeLength` | 否 | 0.4–1.8，默认 1.25 | 控制规范绳索总长度 |
| `gravity` | 否 | 0–20，默认 7 | 控制下垂和摆动周期的重量感 |
| `damping` | 否 | 0–0.2，默认 0.025 | 控制摆动衰减 |
| `stiffness` | 否 | 0.1–1，默认 0.92 | 控制长度约束强度，越大越不易拉伸 |
| `swingImpulse` | 否 | 0–8，默认 1.5 | 控制初始横向甩动力度 |
| `solverIterations` | 否 | 整数 1–10，默认 5 | 长绳或高刚度时提高 |
| `anchorMode` | 否 | `start` / `both`，默认 `start` | 单端摆绳或双端悬挂 |

表达对应：长短对应 `ropeLength`；细腻对应 `segmentCount`；绷紧对应高 `stiffness` 与双端锚定；松软对应较低刚度；猛烈摆动对应 `swingImpulse`；沉重下垂对应 `gravity`；很快停下对应高 `damping`。

参数优先级：锚定方式 > 长度 > 摆动力度 > 重力 > 刚度 > 阻尼 > 分段数。`segmentCount` 超过 28 或刚度高于 0.95 时使用 6–9 次求解。

自然语言示例：

- “单端悬挂的钟摆绳”：`anchorMode` 为 `start`，`swingImpulse` 3，`gravity` 9。
- “两端拉住的缆线”：`anchorMode` 为 `both`，`stiffness` 1，`solverIterations` 8。
- “很长、松软、缓慢下垂”：`ropeLength` 1.8，`stiffness` 0.5，`gravity` 4。
- “短绳快速甩动”：`ropeLength` 0.5，`swingImpulse` 6，`damping` 0.01。
- “摆一下很快停住”：`swingImpulse` 2，`damping` 0.16。
- “细腻但稳定的长绳”：`segmentCount` 36，`stiffness` 0.95，`solverIterations` 9。

推荐档位：`swingImpulse` 轻 0.5–1.5 / 中 2–4 / 强 5–7.5；`stiffness` 松 0.3–0.55 / 自然 0.7–0.9 / 紧 0.95–1；`gravity` 轻 1–4 / 中 6–10 / 重 12–18。

中性值与默认行为：默认 18 段、单端固定、中等长度、较紧绳索和自然摆动。服务端无 pins 时使用规范锚点。

不适用范围：绳索断裂、缠绕、自碰撞、刚体关节、三维索具、锚点资源选择。`source_image` 与 `pins` 只由服务器绑定。
