# 数值滚动

- toolName：`number_counter`
- effectId：`fx.data.numberCounter`

## 工具作用

在服务端已校验的起始值与结束值之间生成确定性的数值滚动，并按固定格式显示。实际数值来自服务端绑定，不由模型生成。

## 输出约束

只输出 JSON，`type` 必须严格等于 `number_counter`。`data` 中不得出现实际数据值、数据源或资源信息。

```json
{
  "type": "number_counter",
  "data": {
    "format": "integer",
    "duration": 1.2,
    "easing": "ease_out"
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `format` | 是 | `integer` / `decimal_1` / `decimal_2` / `percent` | `integer` | 显示格式 |
| `duration` | 是 | 0.1–30 秒 | 1.2 | 完成滚动所需时间 |
| `easing` | 否 | `linear` / `ease_out` / `smooth` | `ease_out` | 数值推进节奏 |

## 选择策略

“更快”降低 `duration`；“更平滑”选 `smooth` 并适度延长时长；“匀速”选 `linear`；“快速到位”选 `ease_out`；需要一位或两位精度时选对应小数格式。

## 参数优先级

先根据数据语义确定 `format`，再按镜头时间确定 `duration`，最后选 `easing`。格式优先于速度，不能用格式字段改变服务端数值。

## 自然语言示例

1. 用整数快速滚到最终结果。
2. 保留两位小数，平滑计数两秒。
3. 做一个一秒完成的百分比增长。
4. 数值匀速变化，不要缓入缓出。
5. 前面变化快，接近终点时慢下来。
6. 小数保留一位，节奏柔和一点。

## 推荐值、默认值和中性值

默认及中性值为 `format=integer`、`duration=1.2`、`easing=ease_out`。信息大字报常用 0.8–1.5 秒；精确财务数值可选 `decimal_2` 和 1.5–2 秒。

## 非适用范围

不生成起止数值、数据源、货币种类、图层、字体、路径或 URL；不负责抓取实时数据，也不执行公式或任意代码。
