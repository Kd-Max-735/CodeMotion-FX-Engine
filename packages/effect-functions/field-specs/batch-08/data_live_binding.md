# 实时数据绑定

- toolName：`live_binding`
- effectId：`fx.data.liveBinding`

## 工具作用

在用户上传的图片或视频上绘制数据仪表盘，并在指定时间内把指针从起始值平滑摆动到目标值。模型查看素材后输出归一化位置；数据字段、目标句柄和目标属性仍由服务端绑定，模型不能提供路径、代码或属性名。

## 输出约束

只输出 JSON，`type` 必须严格等于 `live_binding`。禁止输出表达式、代码、字段路径、数据源、目标身份或额外字段。

```json
{
  "type": "live_binding",
  "data": {
    "mapping": "normalized",
    "fallback": "hold",
    "smoothing": 0.25,
    "gain": 1,
    "offset": 0,
    "threshold": 0.5,
    "startValue": 0,
    "endValue": 100,
    "duration": 5,
    "positionX": 0.5,
    "positionY": 0.55,
    "size": 0.42,
    "color": "#48e2ff"
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `mapping` | 是 | `direct` / `normalized` / `threshold` / `pulse` | `normalized` | 固定映射算法 |
| `fallback` | 是 | `zero` / `hold` / `skip` | `hold` | 缺值时归零、保持或跳过 |
| `smoothing` | 否 | 0–1 | 0.25 | 新旧值混合程度，越大越平滑 |
| `gain` | 否 | -10–10 | 1 | 映射后倍率 |
| `offset` | 否 | -10000–10000 | 0 | 映射后偏移 |
| `threshold` | 否 | -10000–10000 | 0.5 | 阈值映射的分界值 |
| `startValue` | 否 | -1000000–1000000 | 0 | 指针起始值 |
| `endValue` | 否 | -1000000–1000000 | 100 | 指针目标值；在 `duration` 结束时准确到达 |
| `duration` | 否 | 0.2–30 秒 | 5 | 从起始值摆动到目标值的时间 |
| `positionX` / `positionY` | 否 | 0–1 | 0.5 / 0.55 | 仪表中心在素材中的位置，由图像理解确定 |
| `size` | 否 | 0.1–1 | 0.42 | 仪表相对画面短边的尺寸 |
| `color` | 否 | `#RRGGBB` | `#48e2ff` | 仪表激活刻度颜色 |

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `source_image` | `image` | 是 | 用户上传的图片或服务端逐帧解码的视频背景 |
| `validated_binding` | `data` | 是 | 服务端校验、授权并锁定的数据快照和白名单目标 |

## 选择策略

“从 0 摆动到 100，摆动时间 5 秒”映射为 `startValue=0,endValue=100,duration=5`。位置表达必须结合上传素材转换为 `positionX/positionY`；颜色和大小分别写入 `color`、`size`。

## 参数优先级

先选 `mapping`，再明确 `fallback`，随后设置 `threshold`，最后调 `smoothing`、`gain`、`offset`。安全优先级最高：不得用任何字段模拟数据源或任意属性访问。

## 自然语言示例

1. 在汽车右上方放一个蓝色仪表盘，5 秒内从 0 摆动到 100。
2. 在画面中央放一个小仪表，3 秒内从 20 到 80。
3. 数据超过 0.7 就切换为告警颜色，缺值时归零。

## 推荐值、默认值和中性值

默认及中性值为 `mapping=normalized`、`fallback=hold`、`smoothing=0.25`、`gain=1`、`offset=0`、`threshold=0.5`。高频数据推荐 `smoothing` 0.4–0.7。

## 非适用范围

不生成数据源、字段名、属性路径、目标图层、资源 ID、URL、表达式或任意代码；不读取嵌套对象，不执行函数，也不绕过服务端类型和权限校验。
