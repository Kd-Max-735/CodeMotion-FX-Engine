# 图层混合 `blend`

将服务端绑定的上层画面与底层画面按指定混合模式、不透明度、预乘处理和总混合量进行合成。对应现有特效 `fx.composite.blend`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "blend",
  "data": {
    "mode": "normal",
    "opacity": 1,
    "premultiply": true,
    "mix": 1
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `mode` | 是 | `normal` / `multiply` / `screen` / `add` / `difference` | 按用户要求的混合视觉选择精确枚举 |
| `opacity` | 是 | 数字 `0..1`，步长 `0.01` | 上层画面的基础不透明度 |
| `premultiply` | 是 | 布尔值 | 默认 `true`；只有明确要求按非预乘方式处理时用 `false` |
| `mix` | 是 | 数字 `0..1`，步长 `0.01` | 整体效果混合量，作为最终强度控制 |

## 参数选择规则

- 普通覆盖选 `normal`；压暗叠色选 `multiply`；提亮滤黑选 `screen`；强烈加亮选 `add`；反差/反相风格选 `difference`。
- 用户说“上层透明度”调整 `opacity`；说“整个混合效果弱一点/干湿比”调整 `mix`。
- `opacity` 与 `mix` 在实现中相乘。只需降低一种强度时优先保持另一项为 `1`，避免重复衰减。
- Alpha 素材默认 `premultiply=true`；这不是视觉强弱开关，不要因“更亮/更暗”修改它。
- 模式选择优先级高于强度；未指定强度时使用完整 `opacity=1`、`mix=1`。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 正常叠加，上层不透明度一半 | `{"mode":"normal","opacity":0.5,"premultiply":true,"mix":1}` |
| 正片叠底，效果保留七成 | `{"mode":"multiply","opacity":1,"premultiply":true,"mix":0.7}` |
| 滤色提亮，整体克制一点 | `{"mode":"screen","opacity":1,"premultiply":true,"mix":0.6}` |
| 强烈线性加亮，上层八成透明度 | `{"mode":"add","opacity":0.8,"premultiply":true,"mix":1}` |
| 差值混合，明确按非预乘处理 | `{"mode":"difference","opacity":1,"premultiply":false,"mix":1}` |

## 推荐档位

| 强度 | `opacity` 或 `mix` |
| --- | ---: |
| 关闭 | `0` |
| 轻微 | `0.25..0.4` |
| 中等 | `0.5..0.7` |
| 强烈 | `0.8..1` |

默认值为 `mode=normal`、`opacity=1`、`premultiply=true`、`mix=1`。`opacity=0` 或 `mix=0` 可关闭上层贡献，`1` 表示完整强度；`premultiply=true` 是默认 Alpha 处理。混合枚举没有数值强弱顺序，`add` 往往最亮但不应当作所有“强烈”请求的默认模式。

底层和上层画面由服务端绑定，不生成第二路视频、图片、资源 ID、路径或 URL。本工具不选择素材，不用于遮罩显现、轨道 matte、置换扭曲、调色或多层效果栈组合。

## 服务器输入槽（不进入模型 `data`）

- `source_layer`（必需，`data`，单个）：服务端绑定第一张已授权图片作为底层画面及其栅格化结果。图片身份不进入模型参数；缺失时必须停止执行。
- `overlay_layer`（必需，`image`，单个）：服务端绑定第二张已授权图片作为上层画面。它必须与底层图片使用不同的授权资源 ID，不再从底层图片派生替代画面；缺失或与底层重复时必须停止执行。
