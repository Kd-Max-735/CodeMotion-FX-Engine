# 人声响应文字

- toolName：`vocal_reactive_text`
- effectId：`fx.audio.vocalReactiveText`

## 工具作用

使用服务端真实音频分析中的指定频段能量，驱动已绑定文字图层的固定白名单属性。文字图层和字体均由服务端授权绑定。

## 输出约束

只输出一个 JSON 对象。禁止输出解释、图层身份、字体身份、音频信息或未声明字段。`type` 必须严格等于 `vocal_reactive_text`。

```json
{
  "type": "vocal_reactive_text",
  "data": {
    "band": "vocal",
    "mapping": "scale",
    "smoothing": 0.35,
    "amount": 0.4,
    "baseline": 1
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `band` | 是 | `full` / `bass` / `mid` / `vocal` / `high` | `vocal` | 读取的分析频段 |
| `mapping` | 是 | `scale` / `opacity` / `position_y` / `tracking` | `scale` | 允许驱动的文字属性 |
| `smoothing` | 否 | 0–1 | 0.35 | 越大越平滑 |
| `amount` | 否 | 0–3 | 0.4 | 响应幅度 |
| `baseline` | 否 | -2–2 | 1 | 无声音量时的基准值 |

## 选择策略

“突出人声”选 `vocal`；“跟低音”选 `bass`；“更敏感”提高 `amount` 或降低 `smoothing`；“更平滑”提高 `smoothing`；“更快”降低 `smoothing`；“更亮/更明显”对 `opacity` 提高 `amount`，但注意基准值。

## 参数优先级

先选 `band`，再选有限的 `mapping`，之后设 `baseline`，最后用 `smoothing` 与 `amount` 平衡稳定性和响应速度。不得用自由文本属性替代 `mapping`。

## 自然语言示例

1. 让文字跟随人声轻轻放大，变化平滑。
2. 高频出现时让文字更清晰地闪现。
3. 跟着低音上下跳动，响应快一点。
4. 用整体响度控制字距，幅度不要太大。
5. 人声强时明显放大，停顿时回到正常大小。
6. 让歌词透明度柔和呼吸，不要抖动。

## 推荐值、默认值和中性值

默认及中性值为 `band=vocal`、`mapping=scale`、`smoothing=0.35`、`amount=0.4`、`baseline=1`。口播推荐 `smoothing` 0.4–0.65；快节奏演唱推荐 0.15–0.35。

## 非适用范围

不生成文字内容、字体、音频、图层 ID、任意属性路径或表达式；不做语音识别、歌词对齐、节拍检测或多图层编排。
