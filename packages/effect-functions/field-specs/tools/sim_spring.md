# 弹簧动力学 `sim_spring`

用户已经选中本工具。你只需决定质量弹簧链的参数；工具用固定步长和受限子步计算弹簧力、阻尼、重力、锚定和初始冲量，并渲染有螺旋圈、金属高光、阴影和图像负载的可辨识弹簧。

只输出 JSON。`type` 必须严格等于 `sim_spring`，`data` 只能使用下表字段，不得输出解释、资源或其他工具。`source_image` 是服务器授权输入，不属于模型参数。

合法示例：

```json
{"type":"sim_spring","data":{"nodeCount":16,"stiffness":52,"damping":2.8,"gravity":6,"restLength":0.1,"impulseStrength":2.4,"substeps":3,"anchorMode":"first","anchorX":0.22,"anchorY":0.18}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `nodeCount` | 否 | 整数 3–32，默认 12 | 节点越多形变越细，但不是长度本身 |
| `stiffness` | 否 | 5–120，默认 38 | 大值更硬、更快恢复，小值更柔软 |
| `damping` | 否 | 0.1–10，默认 2.4 | 大值快速停止振荡，小值持续弹跳 |
| `gravity` | 否 | 0–20，默认 4 | 控制向下垂落和负载感 |
| `restLength` | 否 | 0.03–0.3，默认 0.12 | 控制相邻节点自然间距 |
| `impulseStrength` | 否 | 0–12，默认 1.5 | 控制开始时的扰动力度 |
| `substeps` | 否 | 整数 1–4，默认 2 | 高刚度时提高稳定性；通常 2–3 即可 |
| `anchorMode` | 否 | `first` / `both` / `none`，默认 `first` | 单端悬挂、双端悬挂或自由链 |
| `anchorX` | 否 | 0–1，步长 0.001，默认 0.22 | 弹簧起点横向位置；需要定位物体或部位时由视觉理解确定 |
| `anchorY` | 否 | 0–1，步长 0.001，默认 0.18 | 弹簧起点纵向位置；需要定位物体或部位时由视觉理解确定 |

表达对应：硬/紧对应 `stiffness`；弹跳持久对应低 `damping`；沉重下垂对应高 `gravity`；猛烈甩动对应 `impulseStrength`；更长间隔对应 `restLength`；更细腻对应 `nodeCount`。速度主要由冲量和刚度共同决定。

参数优先级：起点位置 > 锚定方式 > 软硬 > 重力 > 振荡衰减 > 初始冲量 > 节点数量。用户指定图片中的人物、物体或部位时，必须查看输入图片并把目标视觉中心转换为左上角原点的 `anchorX/anchorY` 归一化坐标。`stiffness` 高于 75 时优先把 `substeps` 设为 3–4。

自然语言示例：

- “柔软的单端弹簧链”：`stiffness` 14，`damping` 1，`anchorMode` 为 `first`。
- “快速回弹并马上稳定”：`stiffness` 85，`damping` 6，`substeps` 4。
- “双端吊桥一样下垂”：`anchorMode` 为 `both`，`gravity` 9，`nodeCount` 22。
- “无重力自由弹动”：`gravity` 0，`anchorMode` 为 `none`，`impulseStrength` 3。
- “沉重、几乎不弹”：`gravity` 15，`damping` 8，`stiffness` 55。
- “间距短的细密弹簧”：`restLength` 0.05，`nodeCount` 28。
- “弹簧起点位于人物鼻子处”：视觉定位鼻子中心并填写 `anchorX/anchorY`。

推荐档位：`stiffness` 软 8–25 / 中 30–60 / 硬 70–110；`damping` 持续振荡 0.3–1.5 / 自然 2–4 / 快停 5–9；`gravity` 轻 0–3 / 中 4–9 / 重 10–18。

中性值与默认行为：默认是 12 节点、单端固定、中等弹性与阻尼、轻度重力和冲量，起点在画面左上区域。含糊描述使用默认值。渲染器使用连续轴线、密集金属螺旋圈和抗弯中心线，不能画成普通绳索。

不适用范围：二维刚体碰撞、布料面、软体体积、真实材料标定、服务端资源选择。`source_image` 只由服务器绑定。
