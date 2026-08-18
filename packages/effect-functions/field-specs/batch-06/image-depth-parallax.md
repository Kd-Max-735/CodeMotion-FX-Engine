# 图像深度视差（image_depth_parallax）

## 工具作用

使用服务端绑定并对齐的图片与深度图建立网格位移，在透视相机下产生真实的近远层运动差。深度图和图片都不是 `data` 参数。

## 服务器资源要求与接入状态

- 用户只上传 `source_image`。`source_depth` 由服务器从这张已授权图片派生并锁定，不占用第二个上传位，也不进入模型参数。
- 接入状态：**PASS**。当前服务端使用对齐深度场逐像素位移，`motionX` 只控制横轴、`motionY` 只控制纵轴，近景与远景产生不同幅度的视差。

## JSON 示例

```json
{"type":"image_depth_parallax","data":{"startTime":0,"duration":5,"motionX":0.2,"motionY":-0.08,"depthScale":0.5,"cameraDistance":3,"meshDensity":128,"edgeExpansion":0.12,"easing":"ease_in_out"}}
```

## 参数字段

| 字段 | 类型与范围 | 默认值 | 推荐值 | 中性值 | 含义 |
| --- | --- | ---: | --- | ---: | --- |
| `startTime` | number，0–3600 秒 | 0 | 0–3 | 0 | 视差开始时间 |
| `duration` | number，>0–120 秒 | 4 | 3–8 | 4 | 相机运动时长 |
| `motionX/Y` | number，各 -1–1 | 0.12 / -0.04 | -0.3–0.3 | 0 | 相机横向/纵向距离 |
| `depthScale` | number，0–2 | 0.35 | 0.2–0.8 | 0 | 深度位移强度 |
| `cameraDistance` | number，0.5–20 | 2.5 | 2–5 | 2.5 | 透视相机距离 |
| `meshDensity` | integer，16–256 | 96 | 64–160 | 96 | 深度网格横向细分数 |
| `edgeExpansion` | number，0–0.5 | 0.08 | 0.05–0.2 | 0 | 位移时的边缘扩展 |
| `easing` | 四种标准缓动 | `ease_in_out` | `ease_in_out` | `linear` | 相机移动节奏 |

## 选择规则与优先级

方向词直接确定 `motionX/Y` 的符号；“更有纵深”提高 `depthScale`，不是无限提高相机位移。强运动同时适度提高 `edgeExpansion`；精细轮廓可提高 `meshDensity`，但不改变强度。优先级：明确运动方向/距离 > 深度强度 > 时长与质量词 > 默认值。

## 用户表达示例

- “照片做轻微向右的 3D 视差。”
- “镜头向左上方缓慢穿行五秒。”
- “纵深强一点，边缘要安全。”
- “只做上下漂移，不要横移。”
- “做细腻的高密度深度网格。”
- “保持中性，不要产生明显位移。”

## 不适合处理

不用于生成深度图、选择图片或深度文件、普通二维缩放、视频变速、三维模型爆裂或修复错误深度数据。
