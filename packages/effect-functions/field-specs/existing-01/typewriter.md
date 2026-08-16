# 打字机显现 `typewriter`

按字形单元逐步显示服务端绑定的文字，可显示游标或按近似词组分段显现。对应现有特效 `fx.text.typewriter`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "typewriter",
  "data": {
    "speed": 12,
    "cursor": true,
    "wordMode": false,
    "cursorWidth": 0.08
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `speed` | 是 | 数字 `0.1..120` 字形/秒，步长 `0.1`，默认 `12` | 用户明确字/秒时直接采用；快速打字提高此值 |
| `cursor` | 是 | 布尔值，默认 `true` | 提到光标、插入符时为 `true`；要求纯文字显现时为 `false` |
| `wordMode` | 是 | 布尔值，默认 `false` | `false` 逐字形；用户要求按词、成组出现时设 `true` |
| `cursorWidth` | 是 | 数字 `0.01..1` 字形宽度，步长 `0.01`，默认 `0.08` | 仅影响游标宽度；`cursor=false` 时保持默认即可 |

## 参数选择优先级

先用 `wordMode` 决定逐字或分组，再用 `speed` 定节奏。`cursorWidth` 只在 `cursor=true` 时有意义，不要通过加宽游标来表达更快速度。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 正常速度逐字打出来，带光标 | `speed=12, cursor=true, wordMode=false, cursorWidth=0.08` |
| 慢慢逐字出现，不要光标 | `speed=4, cursor=false, wordMode=false, cursorWidth=0.08` |
| 快速打字 | `speed=40, cursor=true, wordMode=false, cursorWidth=0.06` |
| 按词组逐段出现 | `speed=10, cursor=false, wordMode=true, cursorWidth=0.08` |
| 用粗光标打字 | `speed=12, cursor=true, wordMode=false, cursorWidth=0.25` |

`speed` 推荐值：轻缓 `4`，中等 `12`，明显快速 `30`，强烈快速 `60`。默认逐字形、每秒 `12` 个字形并显示窄游标；关闭游标不改变显现节奏。文字内容、字体和字形由服务端绑定，不属于 `data`。

本工具不改写文字内容，不处理文字变形、乱码解码、路径排版、语音同步或字体选择，也不要输出文本资源 ID、字体、文件路径或 URL。

## 服务器输入槽（不进入模型 `data`）

- `text_raster`（必需，`data`，单个）：服务端根据真实文字、字体和字形覆盖生成的文字栅格。上传图片不能替代文字输入；缺失时必须停止执行。
