# 像素溶解 `pixel_dissolve`

把服务端绑定的 A、B 两路画面划分为像素块，并按随机、线性或径向顺序确定性溶解。对应现有特效 `fx.transition.pixelDissolve`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "pixel_dissolve",
  "data": {
    "grid": 20,
    "order": "random",
    "seed": 1,
    "progress": 1,
    "duration": 2
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `grid` | 是 | 数字 `2..128`，步长 `1`，网格单元数 | 越大块越细密，越小块越粗大 |
| `order` | 是 | `random` / `linear` / `radial` | 随机散开、横向顺序或从中心径向推进 |
| `seed` | 是 | 数字 `0..100000`，步长 `1` | `random` 下选择可复现排列；`linear` 下 `1/2/3/4` 分别表示左到右、右到左、上到下、下到上 |
| `progress` | 是 | 数字 `0..1`，步长 `0.01` | 完整转场必须为 `1`；不要用它表达轻微/明显，视觉风格由 `grid` 和 `order` 控制 |
| `duration` | 是 | 数字 `0.2..30` 秒，步长 `0.1` | 从 A 完整溶解到 B 的时间；结束后保持 B |

## 参数选择规则

- “大像素块”降低 `grid`；“细碎像素”提高 `grid`。`grid` 是每轴网格密度，不是像素尺寸。
- “随机溶解”选 `random`；“从一侧依次”选 `linear`；“从中心向外”选 `radial`。径向前沿必须保持可见方块，不能变成光滑圆环。
- `random` 下只有用户要求更换随机图案或给出种子时才修改 `seed`。`linear` 下方向映射为：左到右 `1`、右到左 `2`、上到下 `3`、下到上 `4`；`radial` 下保留默认 `1`。
- 块大小由 `grid` 决定，空间顺序由 `order` 决定，随机变体由 `seed` 决定。
- 完整的图片转场始终使用 `progress=1`；“轻微/明显”只调整块大小、顺序和随机图案，不得把 `progress` 降到一半。
- `duration` 控制从 A 到 B 的时间，达到时必须保持 B，不得回到 A 或停在中间。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 4 秒完成大块随机溶解，种子 42 | `{"grid":8,"order":"random","seed":42,"progress":1,"duration":4}` |
| 默认像素溶解并完成 | `{"grid":20,"order":"random","seed":1,"progress":1,"duration":2}` |
| 5 秒细碎像素从左向右依次切换 | `{"grid":64,"order":"linear","seed":1,"progress":1,"duration":5}` |
| 大块像素从下向上完成切换 | `{"grid":8,"order":"linear","seed":4,"progress":1,"duration":2}` |
| 从中心径向溶解，块稍大并完成 | `{"grid":12,"order":"radial","seed":1,"progress":1,"duration":2}` |
| 使用种子 9001 的随机图案并完成 | `{"grid":20,"order":"random","seed":9001,"progress":1,"duration":2}` |

## 推荐档位

| 块大小 | `grid` | 阶段 | `progress` |
| --- | ---: | --- | ---: |
| 粗大 | `6..10` | 开始 | `1` |
| 中等 | `20` | 中段 | `1` |
| 细密 | `48..64` | 快结束 | `1` |
| 极细 | `96..128` | 完成 | `1` |

默认值为 `grid=20`、`order=random`、`seed=1`、`progress=1`、`duration=2`。完整转场固定使用 `progress=1`；`grid=2` 是最粗网格，`grid=128` 是最细网格；随机模式的种子没有视觉强弱意义，线性模式仅使用方向码 `1..4`。

A、B 两路素材由服务端绑定，不生成第二路视频、纹理、资源 ID、路径或 URL。本工具不创建素材，不用于液态边缘、柔和线性擦除、径向扇形擦除或粒子物理消散。
