# 方向模糊 `directional_blur`

沿指定角度和像素距离对服务端绑定的画面进行多采样方向模糊。对应现有特效 `fx.post.directionalBlur`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "directional_blur",
  "data": {
    "angle": 0,
    "distance": 12,
    "samples": 8,
    "edgeMode": "clamp"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `angle` | 是 | 数字 `-360..360` 度，步长 `1` | `0` 水平，`90` 垂直；按用户方向选择 |
| `distance` | 是 | 数字 `0..128` 像素，步长 `1` | 模糊长度和强弱的首选参数 |
| `samples` | 是 | 数字 `1..32`，步长 `1` | 请求的采样上限；越多越平滑、开销越高，实际值受服务端质量档限制 |
| `edgeMode` | 是 | `clamp` / `wrap` / `mirror` | 默认 `clamp`；无缝纹理用 `wrap`，反射边缘用 `mirror` |

## 参数选择规则

- 水平、垂直、斜向分别优先使用 `0`、`90`、`±45` 度；用户给出角度时直接采用。
- “拖得更长/速度感更强”提高 `distance`；“更平滑”提高 `samples`，不要混淆两者。
- 普通请求使用 `samples=8`；克制效果可 `4..8`，高质量强模糊可请求 `12..20`，实际采样仍由服务端质量档封顶。
- `angle=180` 与 `0` 在对称采样下方向轴等价；优先使用简单角度表达。
- 未提及边缘行为时使用 `clamp`，不因“循环播放”自动选择 `wrap`，除非素材本身要求无缝平铺。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 水平方向轻微拖影 | `{"angle":0,"distance":5,"samples":6,"edgeMode":"clamp"}` |
| 竖直方向模糊 20 像素 | `{"angle":90,"distance":20,"samples":8,"edgeMode":"clamp"}` |
| 45 度强烈速度模糊，要平滑 | `{"angle":45,"distance":48,"samples":16,"edgeMode":"clamp"}` |
| 无缝纹理沿 -30 度模糊 | `{"angle":-30,"distance":16,"samples":10,"edgeMode":"wrap"}` |
| 保持画面不模糊 | `{"angle":0,"distance":0,"samples":1,"edgeMode":"clamp"}` |

## 推荐档位

| 程度 | `distance` | `samples` |
| --- | ---: | ---: |
| 轻微 | `4..6` | `4..6` |
| 中等 | `12` | `8` |
| 明显 | `24..36` | `12` |
| 强烈 | `48..72` | `16..20` |

默认值为 `angle=0`、`distance=12`、`samples=8`、`edgeMode=clamp`。`distance=0` 是无模糊中性值，`samples=1` 是最低采样；`distance=128`、`samples=32` 是极端边界，通常不要同时使用，以免无意义增加开销。

源画面由服务端绑定，不生成图片、视频、资源 ID、路径或 URL。本工具不根据对象真实速度推断运动矢量，不用于高斯柔化、中心缩放/旋转模糊、快门运动模糊或景深。
