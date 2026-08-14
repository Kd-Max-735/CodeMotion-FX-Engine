# 文字变形 `text_morph`

让一段源文字向目标文字做确定性的字形扰动、颜色过渡和位置变化。对应现有特效 `fx.text.textMorph`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "text_morph",
  "data": {
    "sourceText": "CODE",
    "targetText": "MOTION",
    "matchMode": "glyph",
    "progress": 0.5
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `sourceText` | 是 | 非空字符串，最长 4096 字符，默认 `CODE` | 使用用户明确给出的变形前文字；真实函数拒绝空字符串 |
| `targetText` | 是 | 非空字符串，最长 4096 字符，默认 `MOTION` | 使用用户明确给出的变形后文字；真实函数拒绝空字符串 |
| `matchMode` | 是 | `glyph` / `outline` / `position`，默认 `glyph` | 常规字符对应选 `glyph`；强调轮廓扰动选 `outline`；强调位置对应选 `position` |
| `progress` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | `0` 为源端，`1` 为目标端，中间值表示过渡阶段 |

## 参数选择优先级

`sourceText` 与 `targetText` 必须先按用户原文确定，再选择匹配方式和进度。不要把源、目标顺序颠倒来表达反向播放；用户要求反向时应明确交换二者。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| CODE 变成 MOTION，进行到一半 | `sourceText="CODE", targetText="MOTION", matchMode=glyph, progress=0.5` |
| HELLO 刚开始变成 WORLD | `sourceText="HELLO", targetText="WORLD", matchMode=glyph, progress=0.2` |
| A 向 B 做明显轮廓变形 | `sourceText="A", targetText="B", matchMode=outline, progress=0.6` |
| 两段文字按位置对应，接近完成 | `sourceText="旧标题", targetText="新标题", matchMode=position, progress=0.85` |
| 完全显示目标文字阶段 | `sourceText="START", targetText="END", matchMode=glyph, progress=1` |

`progress` 推荐值：轻微开始 `0.2`，中间态 `0.5`，明显接近目标 `0.75`，完成 `1`。默认把 `CODE` 向 `MOTION` 变形到一半；`progress=0` 保持源端，是中性起点。

字体、字形覆盖和渲染素材由服务端绑定。本工具不选择字体、不做语义改写、不生成多段字幕，也不处理图形路径变形或三维挤出；不要输出字体、文件或 URL。
