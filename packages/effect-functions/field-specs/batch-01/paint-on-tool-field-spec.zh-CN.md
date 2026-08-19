# 逐笔绘制显现 `paint_on`

按服务端提供的笔画计划逐步生成笔刷显现蒙版，并作用于已授权源图或 Logo。源素材和笔画不进入模型参数。只输出 JSON，不要附加解释、Markdown 或代码块：

当前 AE Agent 只需上传一张源图；服务器从同一份已授权图像派生笔画计划，并在 `duration` 指定的时间内逐步绘制到 `coverage` 指定的目标比例。

```json
{"type":"paint_on","data":{"duration":4,"coverage":1,"strokeOrder":"forward","brushShape":"round","brushSize":36,"hardness":0.7,"spacing":0.25,"feather":4}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `duration` | 否 | `0.5..30` 秒，默认 `4` | 完成逐笔绘制的时间；“缓慢绘制”应提高到 `5..10` 秒 |
| `coverage` | 否 | `0..1`，默认 `1` | 绘制动画的目标总长度比例 |
| `strokeOrder` | 否 | `forward/reverse/alternating`，默认 `forward` | 原顺序、反顺序或相邻笔画交替方向 |
| `brushShape` | 否 | `round/flat`，默认 `round` | 圆头或扁平笔头几何，不是纹理 |
| `brushSize` | 否 | `1..400` px，默认 `36` | 显现笔刷尺寸 |
| `hardness` | 否 | `0..1`，默认 `0.7` | `1` 为硬边，低值更柔软 |
| `spacing` | 否 | `0.05..1`，默认 `0.25` | 相对笔刷尺寸的印迹间距 |
| `feather` | 否 | `0..100` px，默认 `4` | 显现蒙版额外羽化 |

## 参数选择规则

1. 进度只由 `coverage` 表达；没有顺序要求时保持 `forward`。
2. Logo 轮廓通常使用较小笔刷、高硬度、低羽化；绘画感使用大笔刷和柔边。
3. `brushShape` 仅选择算法笔头形状，不能输出纹理名、文件或资源 ID。

| 自然语言 | 参数对应 |
| --- | --- |
| 只画到三分之一 | `coverage=0.33` |
| 从最后一笔倒着显现 | `strokeOrder="reverse"` |
| 相邻笔画来回刷 | `strokeOrder="alternating"` |
| 清晰描出 Logo 边缘 | `brushSize=18, hardness=0.95, feather=1` |
| 大号柔边笔刷慢慢铺开 | `brushSize=70, hardness=0.35, feather=14` |
| 平头干刷、有明显间距 | `brushShape="flat", spacing=0.5, hardness=0.8` |

| 程度 | `coverage` | `brushSize`/`feather` |
| --- | ---: | --- |
| 轻微 | `0.2` | `18/1` |
| 中等 | `0.5` | `36/4` |
| 明显 | `0.8` | `60/10` |
| 强烈/完成 | `1` | `90/20` |

默认值为示例中的完整 `data`。中性未显现值是 `coverage=0`；硬边中性值是 `hardness=1`、`feather=0`。不适用于自动生成绘画路径、内容修复、纹理绘画或真实湿介质模拟。源图与笔画计划由服务端授权绑定，模型不得引用它们。
