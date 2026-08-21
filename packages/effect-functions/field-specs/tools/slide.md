# 方向划入 `slide`

让服务端绑定的画面按指定方向移动到最终位置，并可加入短暂回弹和自定义二维偏移。对应现有特效 `fx.motion.slide`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "slide",
  "data": {
    "direction": "left",
    "distance": 0.35,
    "overshoot": 0.08,
    "vector": [1, 0],
    "duration": 1.2
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `direction` | 是 | `left` / `right` / `up` / `down`，默认 `left` | 按用户明确的进入方向选择 |
| `distance` | 是 | 数字 `0..2` 画布比例，步长 `0.01`，默认 `0.35` | 控制主要方向的起始距离；`0` 取消主要方向位移 |
| `overshoot` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0.08` | 控制途中越过终点的回弹感；稳重请求取 `0` |
| `vector` | 是 | 两元素数组 `[x,y]`，每项 `-2..2`、步长 `0.01`，默认 `[1,0]` | 兼容默认值 `[1,0]` 不叠加额外偏移；仅在用户明确要求斜向时改为其他向量，正 x 向右，正 y 向下 |
| `duration` | 是 | 数字 `0.05..60` 秒，步长 `0.05`，默认 `1.2` | 控制从画外滑入到最终位置所需的特效时间；通过速度适配，不改变距离和回弹强度 |

## 参数选择优先级

`direction` 与 `distance` 是主运动，`duration` 独立控制滑入速度；非默认 `vector` 才以主距离的四分之一叠加自定义分量。普通左、右、上、下划入保持默认 `vector=[1,0]`，其中上下方向不会产生隐藏的横向位移。只有用户明确要求斜向进入时才修改 `vector`，不要同时用大 `distance` 和大向量重复放大位移。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 从左侧轻轻划入 | `direction=left, distance=0.2, overshoot=0.03, vector=[1,0]` |
| 从右侧快速冲入并回弹 | `direction=right, distance=0.7, overshoot=0.2, vector=[1,0]` |
| 从上方稳稳落入，不要回弹 | `direction=up, distance=0.4, overshoot=0, vector=[1,0]` |
| 从下方明显进入 | `direction=down, distance=0.8, overshoot=0.08, vector=[1,0]` |
| 左上方向斜着进入 | `direction=left, distance=0.5, overshoot=0.06, vector=[1,-1]` |
| 从左侧用 4 秒完成滑入 | `direction=left, distance=0.35, overshoot=0.08, vector=[1,0], duration=4` |

`distance` 推荐值：轻微 `0.15`，中等 `0.35`，明显 `0.7`，强烈 `1.2`。`overshoot` 推荐值：无回弹 `0`，轻微 `0.04`，中等 `0.1`，明显 `0.2`。`duration` 只表示特效完成时间，不等同于视频总时长；视频更长时，完成后保持最终位置。默认值产生 1.2 秒的中等距离左向划入；`distance=0, overshoot=0` 是主要位移的中性设置。

画面和其他素材由服务端绑定。本工具不处理路径跟随、镜头运动、旋转、缩放、跨素材转场或物理碰撞，也不要输出资源字段。

## 服务器输入槽（不进入模型 `data`）

- `source_layer`（必需，`data`，单个）：服务端解析并栅格化的真实主图层。模型不得输出该槽或任何资源身份；缺失时必须停止执行。
