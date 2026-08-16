# 图表揭示

- toolName：`chart_reveal`
- effectId：`fx.data.chartReveal`

## 工具作用

逐项揭示服务端已校验的图表序列，可选择柱、线、面积或饼图表现。标签和数值只来自服务端数据绑定。

## 输出约束

只输出一个合法 JSON 对象，不输出图表数据、数据地址、脚本或其他文本。`type` 必须严格等于 `chart_reveal`。

```json
{
  "type": "chart_reveal",
  "data": {
    "chartType": "bar",
    "duration": 1.5,
    "stagger": 0.08,
    "easing": "smooth",
    "direction": "forward"
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `chartType` | 是 | `line` / `bar` / `area` / `pie` | `bar` | 图表呈现类型 |
| `duration` | 是 | 0.2–30 秒 | 1.5 | 单项完整揭示时长 |
| `stagger` | 否 | 0–2 秒 | 0.08 | 相邻数据项的启动间隔 |
| `easing` | 否 | `linear` / `smooth` | `smooth` | 绘制节奏 |
| `direction` | 否 | `forward` / `reverse` | `forward` | 数据项揭示顺序 |

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `chart_data` | `data` | 是 | 服务端校验并锁定的真实图表标签与有限数值 |

## 选择策略

“更快”降低 `duration` 和 `stagger`；“更平滑”选 `smooth`；“逐个出现更明显”提高 `stagger`；趋势用 `line` 或 `area`，类别比较用 `bar`，占比用 `pie`；“反向绘制”选 `reverse`。

## 参数优先级

先根据数据语义确定 `chartType`，再用画面总时长分配 `duration`，之后设 `stagger`，最后确定缓动和方向。类型选择不能改变服务端数据含义。

## 自然语言示例

1. 柱状图逐项平滑长出来。
2. 用两秒把折线从左到右画完。
3. 面积图反向揭示，项目间隔明显些。
4. 饼图快速依次展开，不要拖沓。
5. 所有数据几乎同时出现，整体更快。
6. 用匀速折线展示稳定增长趋势。

## 推荐值、默认值和中性值

默认及中性值为 `chartType=bar`、`duration=1.5`、`stagger=0.08`、`easing=smooth`、`direction=forward`。数据项很多时推荐把 `stagger` 降至 0.02–0.05。

## 非适用范围

不生成、修改或推断图表数据，不访问数据源，不创建任意脚本、表达式、图层或资源地址；不负责坐标轴文案和统计计算。
