# 电弧连接 `electric_arc`

在服务端绑定的有序端点之间生成确定性多段电弧、谐波偏移和次级分支，并以线性光强输出。只输出 JSON，不要附加解释、Markdown 或代码块：

```json
{"type":"electric_arc","data":{"segmentCount":32,"branchCount":4,"noise":24,"glow":14,"intensity":1.5,"branchLength":0.25,"flickerRate":12}}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `segmentCount` | 否 | 整数 `4..256`，默认 `32` | 每对端点间的折点细分数 |
| `branchCount` | 否 | 整数 `0..32`，默认 `4` | 全部主电弧共享的分支数 |
| `noise` | 否 | `0..300` px，默认 `24` | 主弧和分支的弯折幅度 |
| `glow` | 否 | `0..150` px，默认 `14` | 光晕半径 |
| `intensity` | 否 | `0..10`，默认 `1.5` | 线性光强 |
| `branchLength` | 否 | `0.02..0.8`，默认 `0.25` | 分支相对画面对角线长度 |
| `flickerRate` | 否 | `0..60` Hz，默认 `12` | 形态更新频率；`0` 为固定电弧 |

## 参数选择规则

1. “更弯、更乱”调整 `noise`；“更细腻”提高 `segmentCount`，不要混淆。
2. 分支数量和分支长度分别由 `branchCount`、`branchLength` 控制。
3. 亮度用 `intensity`，扩散范围用 `glow`；静态科技连接线设 `flickerRate=0`。

| 自然语言 | 参数对应 |
| --- | --- |
| 两点间稳定的细电弧 | `noise=10, branchCount=1, glow=6, flickerRate=0` |
| 电弧快速跳动 | `flickerRate=24` |
| 弯折很剧烈 | `noise=60` |
| 大量长分叉 | `branchCount=12, branchLength=0.42` |
| 高精度近景电弧 | `segmentCount=96, noise=20` |
| 强亮但收紧光晕 | `intensity=3.5, glow=8` |

| 程度 | `noise` | `branchCount`/`intensity` |
| --- | ---: | --- |
| 轻微 | `8` | `1/0.8` |
| 中等 | `24` | `4/1.5` |
| 明显 | `55` | `9/3` |
| 强烈 | `110` | `18/6` |

默认值为示例中的完整 `data`。中性直线值是 `noise=0`、`branchCount=0`，关闭光效为 `intensity=0` 或 `glow=0`，静态为 `flickerRate=0`。不适用于沿既定路径传播的闪电、真实电场求解或自动寻找连接对象；端点和 seed 均由服务端提供。
