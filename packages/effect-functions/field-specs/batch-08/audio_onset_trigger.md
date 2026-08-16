# 起音触发

- toolName：`onset_trigger`
- effectId：`fx.audio.onsetTrigger`

## 工具作用

依据服务端绑定的真实起音分析，在信号越过阈值且满足冷却时间时触发一个已由服务端解析的目标特效。目标特效引用不进入模型 `data`。

## 输出约束

只输出 JSON，不附带说明、代码围栏外文本或额外字段。`type` 必须严格等于 `onset_trigger`。

```json
{
  "type": "onset_trigger",
  "data": {
    "threshold": 0.68,
    "cooldown": 0.3,
    "retriggerMode": "rising_edge",
    "strength": 1
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `threshold` | 是 | 0–1 | 0.68 | 起音强度触发阈值 |
| `cooldown` | 是 | 0–5 秒 | 0.3 | 两次有效触发之间的最短时间 |
| `retriggerMode` | 否 | `rising_edge` / `strongest_in_window` | `rising_edge` | 越阈触发或窗口强峰触发 |
| `strength` | 否 | 0–2 | 1 | 传给目标效果的触发强度 |

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `audio_analysis` | `audio` | 是 | 服务端从已授权真实音频生成并锁定的起音分析 |
| `target_effect` | `data` | 是 | 服务端解析并锁定的目标特效句柄 |

## 选择策略

“更敏感”降低 `threshold`；“减少连发”提高 `cooldown`；“更快触发”降低 `cooldown`；“只要强起音”提高 `threshold` 并选 `strongest_in_window`；“冲击更强”提高 `strength`。

## 参数优先级

先用 `threshold` 排除噪声，再用 `cooldown` 控制密度，然后选择重触发模式，最后调 `strength`。阈值与冷却优先于强度。

## 自然语言示例

1. 每次清晰起音触发一次，避免连续抖动。
2. 对细小打击也敏感一些，冷却短一点。
3. 只在强烈起音时触发重冲击。
4. 触发频率慢一点，但每次强度更高。
5. 用上升沿精准打点，保持中等强度。
6. 在密集节奏里只保留窗口内最强触发。

## 推荐值、默认值和中性值

默认及中性值为 `threshold=0.68`、`cooldown=0.3`、`retriggerMode=rising_edge`、`strength=1`。人声或环境音建议阈值 0.7–0.85；清晰打击可用 0.55–0.7。

## 非适用范围

不生成音频、分析结果、内部 `effectRef`、目标地址、资源 ID 或时间线事件；不适合连续频谱形变，也不负责选择被触发的特效。
