# 轨道遮罩 `track_matte`

使用服务端绑定的独立 matte 画面，以 Alpha 或亮度控制源画面的透明度，并支持反相和整体强度。对应现有特效 `fx.composite.trackMatte`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "track_matte",
  "data": {
    "mode": "alpha",
    "invert": false,
    "opacity": 1
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `mode` | 是 | `alpha` / `luma` | matte 的透明度有意义时选 `alpha`；按明暗取遮罩时选 `luma` |
| `invert` | 是 | 布尔值 | 正常 matte `false`；黑白或内外关系反转用 `true` |
| `opacity` | 是 | 数字 `0..1`，步长 `0.01` | 控制 matte 对最终 Alpha 的整体强度 |

## 参数选择规则

- 用户说“Alpha matte、透明通道”选 `alpha`；说“亮度、黑白、白显黑隐”选 `luma`。
- “反相、白隐黑显、取相反区域”使用 `invert=true`。
- “遮罩弱一点、半透明”降低 `opacity`；完整应用使用 `1`。
- 采样依据优先由 `mode` 决定，内外关系再由 `invert` 决定，整体强弱最后由 `opacity` 决定。
- 用户没说 matte 类型时用默认 `alpha`，不要根据资源名称自行猜测。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 使用 Alpha 轨道遮罩，完整应用 | `{"mode":"alpha","invert":false,"opacity":1}` |
| 按亮度做 matte | `{"mode":"luma","invert":false,"opacity":1}` |
| 反相的亮度 matte，强度八成 | `{"mode":"luma","invert":true,"opacity":0.8}` |
| Alpha matte 只影响一半透明度 | `{"mode":"alpha","invert":false,"opacity":0.5}` |
| 关闭轨道遮罩的可见贡献 | `{"mode":"alpha","invert":false,"opacity":0}` |

## 推荐档位

| 强度 | `opacity` | 关系 | `invert` |
| --- | ---: | --- | --- |
| 关闭 | `0` | 正常 | `false` |
| 轻微 | `0.35` | 反相 | `true` |
| 中等 | `0.65` |  |  |
| 完整 | `1` |  |  |

默认值为 `mode=alpha`、`invert=false`、`opacity=1`。`opacity=1` 是完整应用默认值；`opacity=0` 会让源画面完全透明，并不是旁路关闭效果；`invert=false` 是正常关系。枚举没有强弱顺序，必须按 matte 信息来源选择。

matte 和源画面由服务端绑定，不生成 `matteLayer`、第二路视频、资源 ID、路径或 URL。本工具不选择或创建 matte，不编辑其内容，不用于普通遮罩进度动画、图层颜色混合或置换扭曲。
