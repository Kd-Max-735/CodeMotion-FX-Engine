# 字符级联 `character_cascade`

让服务端绑定的文字按字符、词、行或段落依次从水平或垂直方向进入并淡显。对应现有特效 `fx.text.characterCascade`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "character_cascade",
  "data": {
    "stagger": 0.04,
    "axis": "y",
    "offset": 0.25,
    "selector": "character"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `stagger` | 是 | 数字 `0..2` 秒，步长 `0.01`，默认 `0.04` | 相邻选择单元的启动间隔；`0` 同时进入 |
| `axis` | 是 | `x` / `y`，默认 `y` | 水平进入选 `x`，垂直进入选 `y` |
| `offset` | 是 | 数字 `-2..2` 画布比例，步长 `0.01`，默认 `0.25` | 初始偏移；正负值决定相反起始方向 |
| `selector` | 是 | `character` / `word` / `line` / `paragraph`，默认 `character` | 按用户要求的级联粒度选择 |

## 参数选择优先级

先选 `selector` 决定分组，再用 `stagger` 控制组间节奏，最后用 `axis` 与 `offset` 决定进入方向和距离。不要用超大 `stagger` 代替按行或按段分组。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 字符从下方依次出现 | `stagger=0.04, axis=y, offset=0.25, selector=character` |
| 每个词从左侧级联进入 | `stagger=0.12, axis=x, offset=-0.3, selector=word` |
| 各行从上方依次落下 | `stagger=0.2, axis=y, offset=-0.4, selector=line` |
| 整段同时轻微进入 | `stagger=0, axis=y, offset=0.1, selector=paragraph` |
| 字符快速横向瀑布式出现 | `stagger=0.02, axis=x, offset=0.5, selector=character` |

`stagger` 推荐值：轻微 `0.02`，中等 `0.06`，明显 `0.15`，强烈 `0.3`。`offset` 推荐幅度：轻微 `0.1`，中等 `0.25`，明显 `0.5`，强烈 `0.9`。默认按字符垂直级联；`stagger=0, offset=0` 是同步无位移的中性设置。

文字、字体和字形覆盖由服务端绑定。本工具不处理文字内容生成、路径排版、三维文字、词语爆炸或真实段落重排，也不要输出资源字段。

## 服务器输入槽（不进入模型 `data`）

- `text_raster`（必需，`data`，单个）：服务端根据真实文字、字体和字形覆盖生成的文字栅格。上传图片不能替代文字输入；缺失时必须停止执行。
