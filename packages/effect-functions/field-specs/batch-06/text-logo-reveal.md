# 三维文字标志揭示（text_logo_reveal）

## 工具作用

将服务端绑定的文字或 Logo 图片分段，以错峰、位移、翻转明暗和挤出高光完成三维揭示。图片身份不在 `data` 中出现。

## 服务器资源要求与接入状态

- 必需输入槽：`source_image`，一张 owner-authorized、locked 的文字或 Logo 图片。服务器负责分段和立体材质处理，不要求用户上传模型或字体文件。
- 接入状态：**PASS**。当前服务端将源图分段，以错峰位移、交替翻转明暗和挤出高光完成左到右、右到左或中心展开揭示。

## JSON 示例

```json
{"type":"text_logo_reveal","data":{"startTime":0,"duration":2,"segmentCount":16,"stagger":0.5,"extrusionDepth":0.4,"travelDistance":1.5,"rotationDegrees":90,"direction":"center_out","easing":"ease_out"}}
```

## 参数字段

| 字段 | 类型与范围 | 默认值 | 推荐值 | 中性值 | 含义 |
| --- | --- | ---: | --- | ---: | --- |
| `startTime` | number，0–3600 秒 | 0 | 0–3 | 0 | 揭示开始时间 |
| `duration` | number，>0–30 秒 | 1.8 | 1–3 | 1.8 | 全部段落完成时长 |
| `segmentCount` | integer，2–128 | 12 | 8–24 | 12 | 几何分段数量 |
| `stagger` | number，0–0.9 | 0.45 | 0.25–0.7 | 0 | 各段错峰比例 |
| `extrusionDepth` | number，0–5 | 0.3 | 0.1–0.8 | 0 | 三维挤出深度 |
| `travelDistance` | number，0–20 | 1.2 | 0.5–3 | 0 | 沿 Z 轴进入距离 |
| `rotationDegrees` | number，-360–360 度 | 70 | 20–120 | 0 | Y 轴起始翻转角度 |
| `direction` | `left_to_right` / `right_to_left` / `center_out` | `left_to_right` | 按语义选择 | `left_to_right` | 分段揭示顺序 |
| `easing` | 四种标准缓动 | `ease_out` | `ease_out` | `linear` | 局部推进节奏 |

## 选择规则与优先级

“从中间展开”映射到 `center_out`，“从右扫入”映射到 `right_to_left`。更密的条带提高 `segmentCount`，更明显的依次出现提高 `stagger`。立体感优先由 `extrusionDepth` 控制，进入纵深由 `travelDistance` 控制。优先级：明确时间/方向/角度 > 明确立体深度 > 风格描述 > 默认值。

## 用户表达示例

- “Logo 从左到右立体出现。”
- “从中心向两边展开，持续两秒。”
- “分成 20 段依次翻转进场。”
- “不要翻转，只做轻微纵深推进。”
- “做厚一点的 3D 字标揭示。”
- “从右侧快速扫入，错峰明显。”

## 不适合处理

不负责生成文字内容、选择字体、上传 Logo、修改品牌图形、二维手写动画或多工具组合。
