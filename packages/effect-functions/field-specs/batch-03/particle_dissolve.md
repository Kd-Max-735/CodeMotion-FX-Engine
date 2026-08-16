# 粒子溶解 `particle_dissolve`

## 工具作用

按确定性阈值把服务端绑定目标图的像素转为飞散粒子，同时降低原图合成不透明度。目标图由服务端绑定，随机序列只读服务端 `seed`。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"particle_dissolve","data":{"progress":0.5,"particleCount":4000,"force":320,"direction":-35,"turbulence":0.45,"lifetime":1.4,"particleSize":3}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `progress` | 数字 `0..1` | `0.5` | 溶解完成度。 |
| `particleCount` | 整数 `100..50000` | `4000` | 转化粒子的采样数量。 |
| `force` | 数字 `0..2000` | `320` | 飞散初始力度。 |
| `direction` | 数字 `-180..180` | `-35` | 主飞散方向（度）。 |
| `turbulence` | 数字 `0..1` | `0.45` | 方向随机扰动。 |
| `lifetime` | 数字 `0.05..10` | `1.4` | 飞散粒子寿命（秒）。 |
| `particleSize` | 数字 `0.5..40` | `3` | 粒子尺寸（像素）。 |

## 表达映射与选择顺序

- “溶解更多/更彻底”先提高 `progress`；“飞得更猛、更远”提高 `force`。
- “更散、更乱”提高 `turbulence`；“朝某方向消散”改 `direction`。
- “颗粒更多更细”提高 `particleCount` 并降低 `particleSize`；“大块崩解”反向调整。
- `progress` 与 `particleCount` 都影响可见粒子数量：溶解阶段由 `progress` 决定，画面细腻度才由 `particleCount` 决定。
- `force` 与 `lifetime` 都影响距离：先按爆发力度定 `force`，明确停留时间时再改 `lifetime`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 刚开始轻微尘化 | `{"progress":0.15,"particleCount":6500,"force":90,"direction":-35,"turbulence":0.25,"lifetime":2.8,"particleSize":1.5}` |
| 一半经典粒子溶解 | `{"progress":0.5,"particleCount":4000,"force":320,"direction":-35,"turbulence":0.45,"lifetime":1.4,"particleSize":3}` |
| 几乎完全消散 | `{"progress":0.92,"particleCount":5000,"force":360,"direction":-35,"turbulence":0.5,"lifetime":1.5,"particleSize":2.5}` |
| 向右猛烈爆裂 | `{"progress":0.65,"particleCount":2600,"force":950,"direction":0,"turbulence":0.35,"lifetime":0.7,"particleSize":6}` |
| 更散乱的细颗粒 | `{"progress":0.6,"particleCount":9000,"force":420,"direction":-20,"turbulence":0.9,"lifetime":1.8,"particleSize":1}` |

## 推荐值、默认值和中性值

常规推荐 `particleCount=2500..8000`、`force=120..600`、`turbulence=0.2..0.7`。默认值见表。中性效果是 `progress=0`，原图完全保留且没有激活粒子。

## 服务器输入行为

`target_image` 是必需的服务器授权 RGBA 图像。缺失、未锁定、所有者不匹配、尺寸不匹配或没有非透明像素时拒绝；粒子位置和颜色只从该绑定采样。

## 不适用范围

不用于生成或编辑目标图、聚合 Logo、普通淡出、像素排序或持续发射。不得输出目标图 ID、路径、URL 或 `seed`。
