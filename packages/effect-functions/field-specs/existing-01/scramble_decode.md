# 乱码解码 `scramble_decode`

让服务端绑定的目标文字先显示为确定性随机字符，再按指定方向逐步锁定为原文字。对应现有特效 `fx.text.scrambleDecode`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "scramble_decode",
  "data": {
    "charset": "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    "speed": 24,
    "lockDirection": "left-to-right",
    "progress": 0.5
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `charset` | 是 | 非空字符串，最长 256 字符，默认 `ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789` | 仅包含用户希望用于乱码阶段的字符；真实函数拒绝空字符串 |
| `speed` | 是 | 数字 `0.1..240` 字形/秒，步长 `0.1`，默认 `24` | 控制乱码刷新速度，也会加快锁定推进 |
| `lockDirection` | 是 | `left-to-right` / `right-to-left` / `random`，默认 `left-to-right` | 按用户要求的解码顺序选择 |
| `progress` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 整体解码阶段；越大锁定字符越多 |

## 参数选择优先级

`progress` 决定当前阶段，`speed` 决定字符刷新和额外推进速度，`lockDirection` 决定锁定顺序。不要同时把 `speed` 和 `progress` 拉满来表达普通“接近完成”。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 从左到右正常解码一半 | `charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", speed=24, lockDirection=left-to-right, progress=0.5` |
| 从右向左慢慢解码 | `charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", speed=8, lockDirection=right-to-left, progress=0.4` |
| 随机顺序快速锁定 | `charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", speed=60, lockDirection=random, progress=0.65` |
| 只用数字做乱码 | `charset="0123456789", speed=24, lockDirection=left-to-right, progress=0.5` |
| 几乎完全解码 | `charset="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", speed=24, lockDirection=left-to-right, progress=0.9` |

`speed` 推荐值：轻缓 `8`，中等 `24`，明显快速 `60`，强烈快速 `120`。`progress` 推荐为初期 `0.2`、中等 `0.5`、明显 `0.75`、完成 `1`。默认使用大写字母和数字，从左到右解码到一半；`progress=0` 是起始乱码阶段。

目标文字、字体和字形由服务端绑定。本工具不修改目标文案、不做加密解密、不生成代码雨或音频，也不要输出文字资源 ID、字体、路径或 URL。

## 服务器输入槽（不进入模型 `data`）

- `text_raster`（必需，`data`，单个）：服务端根据真实目标文字、字体和字形覆盖生成的文字栅格。上传图片不能替代文字输入；缺失时必须停止执行。
