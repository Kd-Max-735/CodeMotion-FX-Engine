# 字符级联 `character_cascade`

在用户上传的背景图片上，将自然语言指定的印刷体文字按字符、词、行或段落依次从水平或垂直方向进入并淡显。对应现有特效 `fx.text.characterCascade`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "character_cascade",
  "data": {
    "stagger": 0.04,
    "axis": "y",
    "offset": 0.25,
    "selector": "character",
    "text": "春风有信",
    "fontFamily": "song",
    "fontSize": 72,
    "positionX": 0.5,
    "positionY": 0.5,
    "color": "#ffffff"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `stagger` | 是 | 数字 `0..2` 秒，步长 `0.01`，默认 `0.04` | 相邻选择单元的启动间隔；`0` 同时进入 |
| `axis` | 是 | `x` / `y`，默认 `y` | 水平进入选 `x`，垂直进入选 `y` |
| `offset` | 是 | 数字 `-2..2` 画布比例，步长 `0.01`，默认 `0.25` | 初始偏移；正负值决定相反起始方向 |
| `selector` | 是 | `character` / `word` / `line` / `paragraph`，默认 `character` | 按用户要求的级联粒度选择 |
| `text` | 是 | 1–80 个字符，默认 `文字级联` | 严格使用用户要求出现的文字 |
| `fontFamily` | 是 | `song` / `kai` / `sans`，默认 `song` | 宋体、楷书或无衬线印刷体 |
| `fontSize` | 是 | 整数 `12..240` 像素，默认 `72` | 控制文字大小 |
| `positionX` | 是 | 数字 `0..1`，默认 `0.5` | 文字中心横向位置，0 为左、1 为右 |
| `positionY` | 是 | 数字 `0..1`，默认 `0.5` | 文字中心纵向位置，0 为上、1 为下 |
| `color` | 是 | `#RRGGBB`，默认 `#ffffff` | 文字颜色 |

## 参数选择优先级

先提取 `text`，再确定字体、字号、位置和颜色；之后用 `selector` 决定分组、`stagger` 控制组间节奏，最后用 `axis` 与 `offset` 决定进入方向和距离。不要改写用户指定的文字，也不要用超大 `stagger` 代替按行或按段分组。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 白色宋体“春风有信”在画面中央从下方逐字出现 | `text=春风有信, fontFamily=song, color=#ffffff, positionX=0.5, positionY=0.5, stagger=0.04, axis=y, offset=0.25, selector=character` |
| 红色楷书标题在左上方从左侧逐字进入 | `fontFamily=kai, color=#d9363e, positionX=0.22, positionY=0.2, axis=x, offset=-0.3, selector=character` |
| 每个词从右侧级联进入 | `stagger=0.12, axis=x, offset=0.3, selector=word` |

`stagger` 推荐值：轻微 `0.02`，中等 `0.06`，明显 `0.15`，强烈 `0.3`。`offset` 推荐幅度：轻微 `0.1`，中等 `0.25`，明显 `0.5`，强烈 `0.9`。默认按字符垂直级联；`stagger=0, offset=0` 是同步无位移的中性设置。

文字内容、字体类别、大小、位置和颜色属于模型参数；真实字体文件与字形覆盖由服务器解析，字体路径不进入模型参数。本工具不处理路径排版、三维文字、词语爆炸或真实段落重排，也不要输出资源字段。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：用户上传的背景图片。服务器将按 `data` 生成的真实字形动画叠加到该图片上；图片身份不进入模型参数。
