# 轨道遮罩 `track_matte`

使用 SAM3.1 根据自然语言指定对象，在用户上传图片中生成对象遮罩，再用该遮罩控制源画面的透明度。用户只上传一张源图片，不上传独立 matte。对应现有特效 `fx.composite.trackMatte`。

只输出 JSON，不附加解释或代码块：

```json
{"type":"track_matte","data":{"mode":"alpha","invert":false,"opacity":1,"target":"main subject"}}
```

| `data` 字段 | 必填 | 取值与默认值 | 选择策略 |
| --- | --- | --- | --- |
| `mode` | 是 | `alpha` / `luma`，默认 `alpha` | SAM3.1 遮罩通常选 `alpha`；兼容亮度语义时选 `luma`，两者都使用同一对象覆盖率 |
| `invert` | 是 | 布尔值，默认 `false` | 保留目标对象为 `false`，保留目标对象之外区域为 `true` |
| `opacity` | 是 | 数字 `0..1`，步长 `0.01`，默认 `1` | 控制遮罩后的整体 Alpha；`0` 完全透明，`1` 完整应用 |
| `target` | 是 | 非空字符串，最长 80，默认 `main subject` | 将用户指定对象翻译为简短、具体的英文视觉名词短语供 SAM3.1 分割 |

## 参数选择规则

先准确确定 `target`，再决定是否反相，最后选择整体透明度。不要把颜色、动作或背景描述混入 `target`；例如“只保留照片中的汽车”应输出 `target="car"`、`invert=false`。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：用户上传、owner-authorized 且 locked 的源图片；同一张图可短暂提供给唯一 Ark 模型做视觉语义对齐。
- `subject_mask`（必需，`mask`，单个）：服务器根据 `target` 调用 SAM3.1 从 `source_image` 派生的单通道遮罩，前端不要求上传。

本工具不接收独立 matte 图片，不输出图片、遮罩、资源 ID、路径或 URL，不创建多工具流程。
