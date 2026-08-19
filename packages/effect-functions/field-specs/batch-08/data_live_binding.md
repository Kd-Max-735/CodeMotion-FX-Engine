# 实时数据绑定

- toolName：`live_binding`
- effectId：`fx.data.liveBinding`

## 工具作用

把服务端校验后的逐帧数据映射到服务端指定的白名单动画属性。数据字段、目标句柄和目标属性均由服务端绑定；模型不能提供路径、代码或属性名。前端测试不需要上传素材：本地预览会注入一个在 `0..1` 间连续往复的安全演示数据流，因此仪表指针和绑定反馈会持续运动；接入真实业务时则由服务端数据流替代演示值。

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

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `validated_binding` | `data` | 是 | 服务端校验、授权并锁定的数据快照和白名单目标 |

## 选择策略

“更平滑”提高 `smoothing`；“更快响应”降低 `smoothing`；“更敏感”提高 `gain`，阈值模式下可降低 `threshold`；“断线保持”选 `hold`；“缺值隐藏更新”选 `skip`；变化量驱动选 `pulse`。

## 参数优先级

先选 `mapping`，再明确 `fallback`，随后设置 `threshold`，最后调 `smoothing`、`gain`、`offset`。安全优先级最高：不得用任何字段模拟数据源或任意属性访问。

## 自然语言示例

1. 把实时数据归一化后平滑变化，数据缺失时保持上一帧。
2. 让演示数据快速响应，不要太平滑。
3. 数据超过 0.7 就立即切换为告警状态，缺值时归零。
4. 根据相邻数值变化量产生明显脉冲，整体放大八倍。
5. 直接使用实时数值，整体放大两倍并偏移 0.1。
6. 缺值时跳过更新，恢复后快速跟上。

## 推荐值、默认值和中性值

默认及中性值为 `mapping=normalized`、`fallback=hold`、`smoothing=0.25`、`gain=1`、`offset=0`、`threshold=0.5`。高频数据推荐 `smoothing` 0.4–0.7。

## 非适用范围

不生成数据源、字段名、属性路径、目标图层、资源 ID、URL、表达式或任意代码；不读取嵌套对象，不执行函数，也不绕过服务端类型和权限校验。
