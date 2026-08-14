# 实时数据绑定

- toolName：`live_binding`
- effectId：`fx.data.liveBinding`

## 工具作用

把服务端校验后的单个数据快照映射到服务端指定的白名单动画属性。数据字段、目标句柄和目标属性均由服务端绑定；模型不能提供路径、代码或属性名。

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
    "threshold": 0.5
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

## 选择策略

“更平滑”提高 `smoothing`；“更快响应”降低 `smoothing`；“更敏感”提高 `gain`，阈值模式下可降低 `threshold`；“断线保持”选 `hold`；“缺值隐藏更新”选 `skip`；变化量驱动选 `pulse`。

## 参数优先级

先选 `mapping`，再明确 `fallback`，随后设置 `threshold`，最后调 `smoothing`、`gain`、`offset`。安全优先级最高：不得用任何字段模拟数据源或任意属性访问。

## 自然语言示例

1. 把校验后的数据归一化后平滑响应。
2. 数据缺失时保持上一帧，不要跳变。
3. 超过阈值就切换状态，响应要立即。
4. 根据相邻数值变化量产生脉冲。
5. 直接使用数值，但整体放大两倍。
6. 缺值时跳过更新，恢复后快速跟上。

## 推荐值、默认值和中性值

默认及中性值为 `mapping=normalized`、`fallback=hold`、`smoothing=0.25`、`gain=1`、`offset=0`、`threshold=0.5`。高频数据推荐 `smoothing` 0.4–0.7。

## 非适用范围

不生成数据源、字段名、属性路径、目标图层、资源 ID、URL、表达式或任意代码；不读取嵌套对象，不执行函数，也不绕过服务端类型和权限校验。
