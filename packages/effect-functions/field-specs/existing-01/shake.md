# 冲击震动 `shake`

让服务端绑定的画面产生带种子的随机二维震动，并随时间指数衰减。对应现有特效 `fx.motion.shake`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "shake",
  "data": {
    "intensity": 0.04,
    "frequency": 12,
    "decay": 2.5,
    "seedOffset": 0
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `intensity` | 是 | 数字 `0..1` 画布比例，步长 `0.005`，默认 `0.04` | 初始震动幅度；冲击越强取值越大 |
| `frequency` | 是 | 数字 `0..60` Hz，步长 `0.5`，默认 `12` | 随机位置刷新频率；低值更顿挫，高值更密集 |
| `decay` | 是 | 数字 `0..20`，步长 `0.1`，默认 `2.5` | 衰减速度；越大越快停止，`0` 不衰减 |
| `seedOffset` | 是 | 整数 `0..100000`，默认 `0` | 仅用于请求不同但可复现的震动轨迹；没有明确要求时保持 `0` |

## 参数选择优先级

冲击强弱主要用 `intensity`，震感细碎程度用 `frequency`，持续时间感用 `decay`。`seedOffset` 不改变强度，不要把它当作随机度或帧数。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 轻微震一下 | `intensity=0.015, frequency=10, decay=8, seedOffset=0` |
| 中等冲击震动 | `intensity=0.05, frequency=14, decay=3, seedOffset=0` |
| 爆炸般猛烈震动后快速停止 | `intensity=0.16, frequency=24, decay=10, seedOffset=0` |
| 持续的低频晃动 | `intensity=0.04, frequency=4, decay=0, seedOffset=0` |
| 换一条可复现的震动轨迹 | `intensity=0.04, frequency=12, decay=2.5, seedOffset=37` |

`intensity` 推荐值：轻微 `0.01`，中等 `0.04`，明显 `0.08`，强烈 `0.16`。`frequency` 推荐为顿挫 `4`、中等 `12`、密集 `24`、强烈高频 `40`。默认值是中等冲击并逐渐停止；`intensity=0` 是中性设置。

素材由服务端绑定。本工具不处理运动模糊、音频震动、摄像机物理、弹性周期运动或真实地震模拟，也不要输出资源字段。

## 服务器输入槽（不进入模型 `data`）

- `source_layer`（必需，`data`，单个）：服务端解析并栅格化的真实主图层。模型不得输出该槽或任何资源身份；缺失时必须停止执行。
