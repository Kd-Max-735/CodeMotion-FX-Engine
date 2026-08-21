# 布料模拟 `sim_cloth`

用户已经选中本工具。你只决定布料网格分辨率、尺寸、约束刚度、阻尼、重力、风力和求解次数；工具用固定时间步的 Verlet 积分和结构约束把用户的一张图像映射为有褶皱、明暗和风摆的布面。

只输出 JSON，`type` 必须严格为 `sim_cloth`，`data` 只能含下表字段。`cloth_image`、`mesh` 与 `pins` 都由服务端绑定，不得写入 `data`，也不得输出资源 ID、路径或 URL。用户只需上传一张 `cloth_image`。

合法示例：

```json
{"type":"sim_cloth","data":{"resolution":10,"clothWidth":1.4,"stiffness":0.78,"damping":0.03,"gravity":6,"windStrength":2.5,"solverIterations":5}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `resolution` | 否 | 整数 4–14，默认 8 | 每边网格点数；越大越细腻、计算越重 |
| `clothWidth` | 否 | 0.5–1.8，默认 1.2 | 控制无绑定网格时的布面宽度 |
| `stiffness` | 否 | 0.1–1，默认 0.82 | 大值少拉伸，小值更松软 |
| `damping` | 否 | 0–0.2，默认 0.025 | 大值快速停止摆动 |
| `gravity` | 否 | 0–20，默认 5 | 控制下垂重量感 |
| `windStrength` | 否 | 0–8，默认 1.1 | 控制横向周期风力，不等于刚度 |
| `solverIterations` | 否 | 整数 1–8，默认 4 | 高刚度、高分辨率或强风时提高 |

表达对应：丝绸对应较低 `stiffness`、低阻尼、轻重力；帆布对应高刚度、高阻尼、较大重力；强风对应 `windStrength`；厚重下垂对应 `gravity`；细腻褶皱对应提高 `resolution`。速度主要由风和重力驱动。

参数优先级：材质软硬 > 风力 > 重量 > 阻尼 > 分辨率 > 尺寸。强风或刚度超过 0.9 时优先把 `solverIterations` 提到 5–7。

自然语言示例：

- “轻盈丝绸随微风摆动”：`stiffness` 0.4，`gravity` 2，`windStrength` 1.5，`damping` 0.01。
- “厚重帆布几乎不飘”：`stiffness` 0.96，`gravity` 12，`windStrength` 0.3，`damping` 0.09。
- “强风中的旗帜”：`windStrength` 6，`resolution` 12，`solverIterations` 6。
- “无风自然下垂”：`windStrength` 0，`gravity` 7，保持中等刚度。
- “小而松软的布片”：`clothWidth` 0.6，`stiffness` 0.25，`damping` 0.02。
- “细密且稳定的展示布”：`resolution` 14，`stiffness` 0.9，`damping` 0.08，`solverIterations` 7。

推荐档位：`stiffness` 柔软 0.2–0.45 / 自然 0.6–0.85 / 硬挺 0.9–1；`windStrength` 无风 0 / 微风 0.5–1.5 / 强风 3–6.5；`gravity` 轻 1–3 / 中 4–8 / 重 10–17。

中性值与默认行为：默认 8×8 网格、适中宽度、较稳定的布料刚度、轻风与中等重力；无网格时生成规则布面，无 pins 时固定上方两角。

不适用范围：撕裂、碰撞体、自碰撞、三维布料材质标定、资源选择。服务端 `cloth_image`、`mesh` 和 `pins` 不属于模型参数。
