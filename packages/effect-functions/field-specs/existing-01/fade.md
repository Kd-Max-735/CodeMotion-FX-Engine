# 淡入淡出 `fade`

对服务端绑定的画面做确定性的透明度过渡，可用于淡入、淡出或从一种透明度过渡到另一种透明度。对应现有特效 `fx.motion.fade`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "fade",
  "data": {
    "from": 0,
    "to": 1,
    "duration": 1.2,
    "easing": "easeOut"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `from` | 是 | 数字 `0..1`，步长 `0.01`，默认 `0` | 起始不透明度；`0` 完全透明，`1` 完全不透明 |
| `to` | 是 | 数字 `0..1`，步长 `0.01`，默认 `1` | 结束不透明度；淡入时大于 `from`，淡出时小于 `from` |
| `duration` | 是 | 数字 `0.01..60` 秒，步长 `0.01`，默认 `1.2` | 用户明确给出秒数时直接采用；“快速”取较小值 |
| `easing` | 是 | `linear` / `easeIn` / `easeOut` / `easeInOut`，默认 `easeOut` | 匀速选 `linear`；慢起选 `easeIn`；快起慢收选 `easeOut`；两端柔和选 `easeInOut` |

## 参数选择优先级

先用 `from` 与 `to` 决定淡入或淡出，再用 `duration` 决定速度，最后选择 `easing`。不要用反转缓动来代替交换 `from`、`to`。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 从透明快速淡入 | `from=0, to=1, duration=0.4, easing=easeOut` |
| 一秒线性淡出 | `from=1, to=0, duration=1, easing=linear` |
| 两秒柔和出现 | `from=0, to=1, duration=2, easing=easeInOut` |
| 从半透明变为完全显示 | `from=0.5, to=1, duration=1.2, easing=easeOut` |
| 保持七成透明度 | `from=0.7, to=0.7, duration=1.2, easing=linear` |

`duration` 推荐值：轻快 `0.3` 秒，中等 `0.8` 秒，明显舒缓 `1.5` 秒，强烈慢速 `3` 秒。默认行为是 `0` 到 `1`、持续 `1.2` 秒并以 `easeOut` 收尾；`from=to` 是无透明度变化的中性设置。

画面、视频帧和遮罩由服务端绑定，不得输出资源 ID、路径或 URL。本工具不处理位移、缩放、转场叠化、局部遮罩、颜色或模糊请求，也不要虚构这些参数。
