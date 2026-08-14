# 三维物体爆裂（object_explode）

## 工具作用

把服务端绑定的三维模型切分为多个几何碎片，并在真实三维空间中计算每片的位置和旋转。`data` 只描述爆裂运动；模型、纹理和其他素材由服务端绑定，不得写入参数。

## JSON 示例

```json
{"type":"object_explode","data":{"startTime":0,"duration":1.8,"fragmentCount":64,"explosionRadius":4,"spinTurns":2,"gravity":2.5,"originX":0,"originY":0.2,"originZ":0,"easing":"ease_out"}}
```

## 参数字段

| 字段 | 类型与范围 | 默认值 | 推荐值 | 中性值 | 含义 |
| --- | --- | ---: | --- | ---: | --- |
| `startTime` | number，0–3600 秒 | 0 | 0–3 | 0 | 爆裂开始时间 |
| `duration` | number，>0–30 秒 | 1.5 | 0.8–3 | 1.5 | 爆裂完成时长 |
| `fragmentCount` | integer，4–256 | 48 | 24–96 | 48 | 几何碎片数量 |
| `explosionRadius` | number，0.1–20 | 3 | 1–6 | 3 | 三维扩散距离 |
| `spinTurns` | number，0–10 | 1.5 | 0.3–3 | 0 | 碎片旋转圈数 |
| `gravity` | number，-20–20 | 2.5 | 0–6 | 0 | 向下加速度；负值向上 |
| `originX/Y/Z` | number，各 -10–10 | 0 | -1–1 | 0 | 爆裂中心的三维坐标 |
| `easing` | `linear` / `ease_in` / `ease_out` / `ease_in_out` | `ease_out` | `ease_out` | `linear` | 扩散节奏 |

## 选择规则与优先级

时间词先决定 `startTime` 和 `duration`；“更多碎片”只提高 `fragmentCount`，“炸得更远”才提高 `explosionRadius`。“失重”令 `gravity=0`，“向上飘”使用负值。强度冲突时依次服从：明确数值 > 明确方向/距离 > 风格词 > 默认值。未提到的字段保持默认值。

## 用户表达示例

- “模型在 1 秒内迅速炸开。”
- “碎成 80 片，向外飞 5 个空间单位。”
- “做轻微碎裂，不要旋转。”
- “两秒后从物体上方开始爆裂。”
- “失重环境里缓慢散开。”
- “碎片往下坠，旋转两圈。”

## 不适合处理

不用于二维像素溶解、视频剪辑、生成新模型、选择模型文件、创建爆炸音效或同时组合多个特效。
