# 路径文字显现 `text_path_reveal`

让服务端绑定的文字沿服务端授权路径按进度显现，并控制文字朝向与显现边缘柔和度。对应现有特效 `fx.text.textPathReveal`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "text_path_reveal",
  "data": {
    "progress": 0.5,
    "orientation": "tangent",
    "feather": 0.04
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `progress` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.5` | 已显现比例；`0` 未显现，`1` 完成显现 |
| `orientation` | 是 | `tangent` / `upright`，默认 `tangent` | 随路径切线转向选 `tangent`；尽量保持直立选 `upright` |
| `feather` | 是 | 数字 `0..0.5`，步长 `0.005`，默认 `0.04` | 显现边缘的柔和宽度；硬边选 `0` |

历史 Schema 中的 `path` 是矢量路径数据；按当前单工具架构，它必须由服务端授权并绑定，不得出现在模型输出 `data` 中。

## 参数选择优先级

先用 `progress` 决定显现程度，再选择 `orientation`，最后用 `feather` 调整边缘。`feather` 不会增加显现进度，不要用它代替 `progress`。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 沿路径显现一半 | `progress=0.5, orientation=tangent, feather=0.04` |
| 完整显示并沿曲线转向 | `progress=1, orientation=tangent, feather=0.04` |
| 显示三成，文字保持直立 | `progress=0.3, orientation=upright, feather=0.04` |
| 硬边快速揭示到八成 | `progress=0.8, orientation=tangent, feather=0` |
| 很柔和地显现六成 | `progress=0.6, orientation=upright, feather=0.15` |

`progress` 推荐值：轻微 `0.2`，中等 `0.5`，明显 `0.75`，完整 `1`。`feather` 推荐为硬边 `0`、轻微 `0.02`、中等 `0.04`、明显 `0.12`。默认显现一半、沿切线朝向；`progress=0` 是未显现的中性起点。

文字、字体和路径由服务端绑定。本工具不生成或修改路径，不处理普通打字机、文字内容改写、路径绘制或三维文字，也不要输出资源 ID、路径字符串、文件路径或 URL。

## 服务器输入槽（不进入模型 `data`）

- `text_raster`（必需，`data`，单个）：服务端根据真实文字、字体和字形覆盖生成的文字栅格。图片上传模式下，服务器从已授权图片派生文字单元代理，不声称识别图片中的真实文字；图片身份不进入模型参数。缺失时必须停止执行。
- `motion_path`（必需，`data`，单个）：服务端绑定并校验的归一化文字运动路径。图片上传预览使用服务器生成的画布内曲线路径；模型不得输出路径字符串、资源身份或该槽。缺失时必须停止执行。
