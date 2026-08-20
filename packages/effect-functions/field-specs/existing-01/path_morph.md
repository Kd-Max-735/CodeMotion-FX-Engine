# 路径变形 `path_morph`

在两张由服务端授权的图片 A、B 之间完成带方向性的路径变形转场。A 会沿不可见轨道被拉伸、扭曲并滑出，B 沿同一轨道滑入；中间阶段加入流动条纹和动态模糊，结束时稳定停在 B。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "path_morph",
  "data": {
    "normalize": true,
    "progress": 1,
    "duration": 2.5,
    "direction": "left_to_right",
    "strength": 0.38,
    "blur": 5
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `normalize` | 是 | 布尔值，默认 `true` | 通常保持 `true` 以归一化坐标；仅在用户明确要求保留原始宽高比例坐标时设 `false` |
| `progress` | 是 | 数字 `0..1`，步长 `0.01`，默认 `1` | 转场最终完成比例；正常完整转场使用 `1` |
| `duration` | 是 | 数字 `0.2..30` 秒，步长 `0.1`，默认 `2.5` | A 到 B 的转场时长 |
| `direction` | 是 | `left_to_right/right_to_left/top_to_bottom/bottom_to_top/center_out/edge_in`，默认 `left_to_right` | 变形推进方向 |
| `strength` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.38` | 拉伸、撕裂和流动条纹强度 |
| `blur` | 是 | 数字 `0..24` px，步长 `0.1`，默认 `5` | 过渡中动态模糊强度；结束帧自动恢复清晰 |

`normalize` 仅保留为兼容字段，用于保持素材坐标归一化。图片资源 ID 不进入模型参数。

## 参数选择优先级

先按自然语言设置 `direction`、`duration` 和 `strength`，再调 `blur`。除非用户明确要求不归一化，否则保持 `normalize=true`；完整转场保持 `progress=1`。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 图 A 从左向右液态滑走，图 B 滑入 | `normalize=true, progress=1, duration=2.5, direction=left_to_right, strength=0.38, blur=5` |
| 从中心向外融化并放大扭曲 | `normalize=true, progress=1, direction=center_out, strength=0.65, blur=8` |
| 轻微流动转场 | `normalize=true, progress=1, strength=0.2, blur=3` |

`strength` 推荐值：轻微 `0.2`，中等 `0.38`，明显 `0.65`；完整转场建议 `progress=1`。

两张图片由服务端绑定。本工具不生成 SVG、不接受路径字符串、不输出资源 ID、文件路径或 URL。

## 服务器输入槽（不进入模型 `data`）

- `source_frame`（必需，`image`，单个）：服务端授权的图 A。
- `target_frame`（必需，`image`，单个）：服务端授权的图 B。
