# 高斯模糊 `gaussian_blur`

对服务端绑定的源画面执行可分离高斯近似模糊，控制像素半径、遍数、边缘采样和透明边缘处理。对应现有特效 `fx.post.gaussianBlur`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "gaussian_blur",
  "data": {
    "radius": 6,
    "passes": 2,
    "edgeMode": "clamp",
    "alphaAware": true
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `radius` | 是 | 数字 `0..64` 像素，步长 `0.5` | 模糊强弱的首选参数，越大越模糊 |
| `passes` | 是 | 数字 `1..8`，步长 `1` | 增加迭代与平滑度，也会放大有效模糊并增加开销 |
| `edgeMode` | 是 | `clamp` / `wrap` / `mirror` | 默认钳制；无缝循环用环绕，减少镜像接缝用镜像 |
| `alphaAware` | 是 | 布尔值 | 透明素材默认 `true`，按 Alpha 加权避免透明边缘污染 |

## 参数选择规则

- “轻微/明显/强烈模糊”优先映射 `radius`，不要首先增加 `passes`。
- 用户强调“更平滑、更细腻”且接受更高开销时提高 `passes`；普通请求使用 `2`。
- `clamp` 适合一般图片；可平铺纹理选 `wrap`；希望边缘反射延展选 `mirror`。
- 透明 Logo、图层或边缘必须优先 `alphaAware=true`；只有明确要求忽略 Alpha 权重时才设为 `false`。
- 用户给出像素半径或遍数时直接采用符合步长的值；高分辨率画面可在同等观感下适当提高半径。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 轻微软化透明 Logo 的边缘 | `{"radius":2,"passes":2,"edgeMode":"clamp","alphaAware":true}` |
| 普通高斯模糊 | `{"radius":6,"passes":2,"edgeMode":"clamp","alphaAware":true}` |
| 明显模糊，并让结果更平滑 | `{"radius":14,"passes":4,"edgeMode":"clamp","alphaAware":true}` |
| 对无缝纹理做 8 像素模糊 | `{"radius":8,"passes":2,"edgeMode":"wrap","alphaAware":true}` |
| 不模糊，忽略透明度权重 | `{"radius":0,"passes":1,"edgeMode":"clamp","alphaAware":false}` |

## 推荐档位

| 程度 | `radius` | `passes` |
| --- | ---: | ---: |
| 轻微 | `2` | `1..2` |
| 中等 | `6` | `2` |
| 明显 | `14` | `2..4` |
| 强烈 | `28` | `3..4` |

默认值为 `radius=6`、`passes=2`、`edgeMode=clamp`、`alphaAware=true`。`radius=0` 是不产生模糊的中性值；`passes=1` 是最低遍数。`radius=64` 或 `passes=8` 是性能和观感极端，仅在用户明确要求时使用，通常不要同时取最大值。

源图片或视频由服务端绑定，不生成资源 ID、路径或 URL。本工具只做全局高斯模糊，不用于局部背景分割、方向拖影、径向模糊、基于速度的运动模糊或镜头景深。
