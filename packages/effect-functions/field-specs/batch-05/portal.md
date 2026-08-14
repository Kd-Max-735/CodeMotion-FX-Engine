# 传送门转场 `portal`

以前景视频为外部、后景视频为门内内容，生成扩张的径向传送门，并可加入旋涡、柔边和辉光。可选门形遮罩由服务端绑定。

只输出 JSON，不要附加解释或代码围栏。`type` 必须精确为 `portal`，`data` 只能包含下表字段。

```json
{"type":"portal","data":{"duration":1.2,"innerRadius":0.06,"outerRadius":1.05,"swirlTurns":0.75,"edgeSoftness":0.12,"glowStrength":0.55,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `duration` | 否 | `0.2..6` 秒，默认 `1.2` | 控制开启速度 |
| `innerRadius` | 否 | `0..0.5`，默认 `0.06` | 初始孔径，必须小于外半径 |
| `outerRadius` | 否 | `0.2..2`，默认 `1.05` | 最终覆盖距离 |
| `swirlTurns` | 否 | `-4..4` 圈，默认 `0.75` | 正负决定旋转方向，`0` 不旋转 |
| `edgeSoftness` | 否 | `0..0.5`，默认 `0.12` | `0` 硬边，越大越柔 |
| `glowStrength` | 否 | `0..1`，默认 `0.55` | 门边辉光强度 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 按启动和收尾节奏选择 |

## 参数选择方法与优先级

- 顺/逆时针用 `swirlTurns` 正/负表示；“不旋转”必须设为 `0`。
- 快慢先改 `duration`；“突然打开”可配 `ease_out`，“逐渐加速”可配 `ease_in`。
- 角度表达换算为圈数，例如 180 度约为 `0.5` 圈；距离或覆盖范围用 `outerRadius`。
- 柔和度由 `edgeSoftness` 控制，发光由 `glowStrength` 控制，两者不可互相替代。
- 冲突时按“明确圈数/角度 > 旋转方向 > 覆盖距离 > 速度 > 柔和/发光风格”处理，并始终保证 `innerRadius < outerRadius`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 快速打开一个不旋转的门 | `{"duration":0.6,"innerRadius":0.04,"outerRadius":1.1,"swirlTurns":0,"edgeSoftness":0.08,"glowStrength":0.4,"easing":"ease_out"}` |
| 逆时针旋转一圈半 | `{"duration":1.4,"innerRadius":0.05,"outerRadius":1.15,"swirlTurns":-1.5,"edgeSoftness":0.12,"glowStrength":0.6,"easing":"ease_in_out"}` |
| 做一个柔边弱光传送门 | `{"duration":1.5,"innerRadius":0.08,"outerRadius":1,"swirlTurns":0.5,"edgeSoftness":0.3,"glowStrength":0.2,"easing":"ease_in_out"}` |
| 强光旋涡迅速吞没画面 | `{"duration":0.75,"innerRadius":0.02,"outerRadius":1.5,"swirlTurns":2,"edgeSoftness":0.16,"glowStrength":1,"easing":"ease_in"}` |
| 从较大的孔径慢慢展开 | `{"duration":2.5,"innerRadius":0.3,"outerRadius":1.2,"swirlTurns":0.4,"edgeSoftness":0.18,"glowStrength":0.5,"easing":"ease_in_out"}` |
| 使用默认传送门 | `{"duration":1.2,"innerRadius":0.06,"outerRadius":1.05,"swirlTurns":0.75,"edgeSoftness":0.12,"glowStrength":0.55,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐 `duration=0.8..1.8`、`outerRadius=1..1.3`、`swirlTurns=-1.5..1.5`、`edgeSoftness=0.08..0.2`。中性值为 `swirlTurns=0`、`edgeSoftness=0.25`、`glowStrength=0.5`；完整默认值见示例。

两路视频和可选遮罩均由服务端绑定，模型不得输出资源 ID、路径或 URL。本工具不适用于翻页、直线隧道缩放、物体匹配、素材选择或多段传送门组合。
