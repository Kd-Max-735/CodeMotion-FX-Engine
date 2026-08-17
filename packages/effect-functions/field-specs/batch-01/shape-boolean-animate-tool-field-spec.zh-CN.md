# 布尔图形动态组合 `shape_boolean_animate`

将服务端绑定的两个闭合形状转为有符号距离场，执行并集、交集、相减或异或，并按进度显现结果。只输出 JSON，不要附加解释、Markdown 或代码块：

```json
{"type":"shape_boolean_animate","data":{"operation":"union","progress":1,"feather":0,"resolution":48,"easing":"smooth"}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `operation` | 否 | `union/intersect/subtract/xor`，默认 `union` | 合并、保留重叠、A 减 B、仅保留非重叠 |
| `progress` | 否 | `0..1`，默认 `1` | 动画目标比例；视频前 1.4 秒从原 A 过渡到该比例 |
| `feather` | 否 | `0..100` px，默认 `0` | 软化结果边缘 |
| `resolution` | 否 | 整数 `16..128`，默认 `48` | 距离场分辨率；导出或近景可提高 |
| `easing` | 否 | `linear/smooth`，默认 `smooth` | 匀速或平滑过渡 |

## 参数选择规则

1. “合并”选 `union`，“只看重叠”选 `intersect`，“挖掉/扣除”选 `subtract`，“排除重叠”选 `xor`。
2. 用户描述动画中间态才降低 `progress`；完成结果保持 `1`。服务器会在前 1.4 秒自动推进到目标比例。
3. 硬边矢量保持 `feather=0`；柔和遮罩才增加羽化。分辨率服从质量要求，不用于增强强度。

| 自然语言 | 参数对应 |
| --- | --- |
| 把两个图形完整合并 | `operation="union", progress=1` |
| A 被 B 挖掉一半过程 | `operation="subtract", progress=0.5` |
| 只显示两者重叠区域 | `operation="intersect", progress=1` |
| 保留不重叠的部分 | `operation="xor", progress=1` |
| 柔和地合并，边缘羽化 | `operation="union", feather=8, easing="smooth"` |
| 高质量硬边相减 | `operation="subtract", resolution=96, feather=0` |

| 程度 | `progress` | `feather` |
| --- | ---: | ---: |
| 轻微 | `0.2` | `1` |
| 中等 | `0.5` | `4` |
| 明显 | `0.8` | `10` |
| 强烈/完成 | `1` | `24` |

默认值为示例中的完整 `data`。中性状态是 `progress=0`（保持 A）、`feather=0`；布尔操作本身没有通用中性值。不适用于开放路径、三维 CSG、自动形状选择或位图抠图。两个形状由服务端分别绑定，不得写入模型 `data`。
