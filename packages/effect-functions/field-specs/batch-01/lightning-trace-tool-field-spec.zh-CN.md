# 闪电沿路径传播 `lightning_trace`

在一张图片上根据起点和终点锚点生成传播中的主闪电和确定性分支，时间闪烁使用服务器 seed。只输出 JSON，不要附加解释、Markdown 或代码块：

```json
{"type":"lightning_trace","data":{"progress":1,"branchCount":3,"jitter":12,"flicker":0.35,"branchLength":0.18,"segmentLength":14,"glow":6,"startMode":"subject_left","endMode":"subject_right","startX":0.2,"startY":0.5,"endX":0.8,"endY":0.5}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `progress` | 否 | `0..1`，默认 `1` | 闪电沿引导线传播的目标比例；视频前 1.25 秒自动生长到该比例 |
| `branchCount` | 否 | 整数 `0..32`，默认 `5` | 次级分叉数量 |
| `jitter` | 否 | `0..200` px，默认 `18` | 主干横向折动幅度 |
| `flicker` | 否 | `0..1`，默认 `0.35` | 时间形态刷新活跃度 |
| `branchLength` | 否 | `0.02..0.8`，默认 `0.22` | 分支相对画面对角线长度 |
| `segmentLength` | 否 | `2..100` px，默认 `18` | 主干折点间距；越小越细密 |
| `glow` | 否 | `0..100` px，默认 `10` | 外围发光半径 |
| `startMode` / `endMode` | 否 | `coordinates` / `subject_left` / `subject_right` / `subject_top` / `subject_bottom` / `subject_center` / `brightest` | 起止点定位方式 |
| `startX`,`startY`,`endX`,`endY` | 否 | `0..1` | 仅对应 mode 为 `coordinates` 时使用 |

## 参数选择规则

1. 传播终点先选 `progress`；服务端会在前 1.25 秒从起点生长到该终点，形态粗暴程度主要由 `jitter` 决定。
2. 分支繁密度用 `branchCount`，分支伸展范围用 `branchLength`。
3. “频繁抖动”提高 `flicker`；仅要求弯折不要误调闪烁。高质量细节可降低 `segmentLength`。
4. “从车头到车尾”“从鸟头到鸟尾”且画面未给明确方向时，按常见横向构图使用 `subject_left` 到 `subject_right`；用户明确说左右、上下时严格使用对应主体锚点。精确坐标要求使用 `coordinates`。

| 自然语言 | 参数对应 |
| --- | --- |
| 闪电刚传播到一半 | `progress=0.5` |
| 细而克制、只有两条分叉 | `branchCount=2, jitter=8, glow=5` |
| 风暴般大量长分支 | `branchCount=14, branchLength=0.4, jitter=34` |
| 形态频繁闪动 | `flicker=0.8` |
| 主干很曲折但不发光 | `jitter=48, glow=0` |
| 近景要更多折点 | `segmentLength=6` |

| 程度 | `jitter` | `branchCount` |
| --- | ---: | ---: |
| 轻微 | `6` | `1` |
| 中等 | `18` | `5` |
| 明显 | `40` | `10` |
| 强烈 | `80` | `20` |

默认值为示例中的完整 `data`。中性几何值是 `jitter=0`、`branchCount=0`，关闭光晕为 `glow=0`；完整传播为 `progress=1`。不适用于真实电学仿真或无引导路径的随机雷暴。主体锚点由服务端对授权图片做确定性边界分析，不代表语义目标检测。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：闪电叠加的用户图片，同时用于主体边界/亮点锚点分析。
