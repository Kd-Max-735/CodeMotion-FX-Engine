# 线性擦除 `wipe`

在服务端绑定的 A、B 两路画面之间执行可调方向、倾角和柔边的线性擦除。对应现有特效 `fx.transition.wipe`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "wipe",
  "data": {
    "direction": "left",
    "softness": 0.04,
    "angle": 0,
    "progress": 1,
    "duration": 3
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `direction` | 是 | `left` / `right` / `up` / `down` | 按擦除推进方向选择精确枚举 |
| `softness` | 是 | 数字 `0..0.5`，步长 `0.005` | `0` 为硬边，越大过渡带越柔和 |
| `angle` | 是 | 数字 `-180..180` 度，步长 `1` | 在基础方向上旋转擦除边界 |
| `progress` | 是 | 数字 `0..1`，步长 `0.01` | `0` 完全为 A，`1` 完全为 B |
| `duration` | 是 | 数字 `0.2..30` 秒，步长 `0.1` | 完成整次擦除所需时间 |

## 参数选择规则

- “从左向右”映射 `left`，“从右向左”映射 `right`，“从上到下”映射 `up`，“从下到上”映射 `down`。
- “斜着擦”才调整 `angle`；未指定斜率时使用 `0`。
- “硬切边”使用 `softness=0`；“柔和羽化”提高 `softness`。
- 导出转场必须完整完成，`progress` 固定输出 `1`；使用 `duration` 控制实际推进时间。
- 不用 `angle` 代替四个基础方向；先定 `direction`，再叠加小角度倾斜。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 从左向右硬边擦到一半 | `{"direction":"left","softness":0,"angle":0,"progress":0.5}` |
| 从右侧柔和擦入四分之一 | `{"direction":"right","softness":0.1,"angle":0,"progress":0.25}` |
| 从上方斜 20 度擦到七成 | `{"direction":"up","softness":0.04,"angle":20,"progress":0.7}` |
| 从下方宽柔边开始转场 | `{"direction":"down","softness":0.25,"angle":0,"progress":0.1}` |
| 保持默认样式并完成转场 | `{"direction":"left","softness":0.04,"angle":0,"progress":1}` |

## 推荐档位

| 边缘表达 | `softness` | 进度表达 | `progress` |
| --- | ---: | --- | ---: |
| 硬边 | `0` | 开始 | `0.1` |
| 轻柔 | `0.04` | 一半 | `0.5` |
| 明显羽化 | `0.12` | 快结束 | `0.9` |
| 极柔 | `0.3` | 完成 | `1` |

默认值为 `direction=left`、`softness=0.04`、`angle=0`、`progress=1`、`duration=2`。首帧由服务器强制为纯 A，达到 `duration` 后强制为纯 B，并保持 B 到视频结束。

A、B 两路素材由服务端绑定，不生成第二路视频、资源 ID、路径或 URL。本工具不选择素材，不用于扇形擦除、液态边缘、像素块溶解或多段转场组合。
