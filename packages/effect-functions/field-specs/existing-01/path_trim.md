# 路径修剪 `path_trim`

在服务端绑定的图片上，根据 SAM3.1 选定目标物体的真实轮廓进行逐笔描绘。显现模式从黑场开始，沿轮廓推进后逐步露出图片；擦除模式从完整图片开始，沿轮廓推进后逐步变黑。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "path_trim",
  "data": {
    "target": "main subject",
    "mode": "reveal",
    "duration": 3,
    "direction": "left_to_right",
    "strokeWidth": 0.03,
    "strokeColor": "#f4f0df"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `target` | 是 | 1..80 字符英文目标描述，默认 `main subject` | 将用户点名对象翻译成简短、具体的英文视觉名词短语供 SAM3.1 分割 |
| `mode` | 是 | `reveal` / `erase`，默认 `reveal` | 逐渐显现或逐渐擦除 |
| `duration` | 是 | 数字 `0.2..30` 秒，步长 `0.1`，默认 `3` | 描绘完成时间 |
| `direction` | 是 | `left_to_right/right_to_left/top_to_bottom/bottom_to_top/clockwise/counter_clockwise`，默认 `left_to_right` | 轮廓推进方向 |
| `strokeWidth` | 是 | 数字 `0.001..0.5` 画布比例，步长 `0.001`，默认 `0.03` | 轮廓笔触粗细 |
| `strokeColor` | 是 | `#RRGGBB`，默认 `#f4f0df` | 描边笔触颜色 |

## 参数选择优先级

先把用户点名对象翻译成简短英文 `target`，再选择 `mode`，设置自然语言中的完成时间和推进方向，最后调整笔触宽度与颜色。`target` 必须对应图片中可见物体，不输出坐标或路径字符串。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 3 秒完整描出汽车轮廓并显现 | `target=car, mode=reveal, duration=3, direction=left_to_right, strokeWidth=0.03` |
| 2 秒沿顺时针轮廓擦除人物 | `target=person, mode=erase, duration=2, direction=clockwise, strokeWidth=0.025` |
| 粉笔色粗描边 | `mode=reveal, direction=clockwise, strokeWidth=0.08, strokeColor=#f4f0df` |

`duration` 推荐为 `1.5..6` 秒；`strokeWidth` 推荐为细 `0.01`、中等 `0.03`、明显 `0.06`、强烈 `0.12`。显现模式结束显示图片，擦除模式结束为黑场。

图片和 SAM3.1 遮罩由服务端绑定。本工具不生成路径字符串、不输出坐标、资源 ID、文件路径或 URL。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：服务端授权的图片素材。
- `subject_mask`（必需，`mask`，单个）：服务端根据 `target` 调用 SAM3.1 派生的目标轮廓遮罩。
