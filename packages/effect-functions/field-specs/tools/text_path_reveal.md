# 路径文字显现 `text_path_reveal`

把自然语言指定的真实文字沿服务器生成的画布内路径逐步显现，并叠加到用户上传的一张背景图片上。路径是服务器资源，不要求用户再上传第二张图片。对应现有特效 `fx.text.textPathReveal`。

只输出以下 JSON，不附加解释或代码块：

```json
{"type":"text_path_reveal","data":{"progress":0.5,"orientation":"tangent","feather":0.04,"duration":2,"text":"PATH","fontFamily":"sans","fontSize":72,"positionX":0.5,"positionY":0.5,"color":"#ffffff"}}
```

| `data` 字段 | 必填 | 取值与默认值 | 选择策略 |
| --- | --- | --- | --- |
| `progress` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 最终显现比例；完整显示使用 `1` |
| `orientation` | 是 | `tangent` / `upright`，默认 `tangent` | 随路径方向选 `tangent`，保持直立选 `upright` |
| `feather` | 是 | 数字 `0..0.5`，步长 `0.005`，默认 `0.04` | 路径显现边缘的柔和宽度 |
| `duration` | 是 | 数字 `0.2..30` 秒，步长 `0.1`，默认 `2` | 到达 `progress` 所需时间 |
| `text` | 是 | 非空字符串，最长 80，默认 `PATH` | 使用用户明确要求显示的文字 |
| `fontFamily` | 是 | `song` / `kai` / `sans`，默认 `sans` | 宋体、楷书或无衬线印刷体 |
| `fontSize` | 是 | 数字 `12..240`，整数，默认 `72` | 文字字号 |
| `positionX` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 文字中心横坐标，左上原点 |
| `positionY` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 文字中心纵坐标，左上原点 |
| `color` | 是 | `#RRGGBB`，默认 `#ffffff` | 文字颜色 |

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：用户上传、owner-authorized 且 locked 的背景图片，最终视频真实保留该图片。
- `motion_path`（必需，`data`，单个）：服务器生成并校验的归一化文字运动路径，前端不要求上传，模型不得输出路径字符串或资源身份。

本工具不读取第二张图片，不识别图片内文字，不输出资源 ID、文件路径或 URL，也不用于三维 Logo 揭示。
