# 缩放隧道转场 `zoom_tunnel`

让前景视频向镜头外冲出，同时让后景视频从隧道深处推进，并加入可选扭转和运动模糊。两路视频始终由服务端绑定。

只输出 JSON；不要输出说明、Markdown 或资源引用。`type` 必须精确为 `zoom_tunnel`。

```json
{"type":"zoom_tunnel","data":{"duration":0.9,"startScale":0.25,"endScale":3,"tunnelDepth":6,"motionBlur":0.55,"twistDegrees":0,"easing":"ease_in_out"}}
```

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `duration` | 否 | `0.2..5` 秒，默认 `0.9` | 越小穿梭越快 |
| `startScale` | 否 | `0.05..1`，默认 `0.25` | 后景起始缩放，越小显得越远 |
| `endScale` | 否 | `1.1..8`，默认 `3` | 前景结束缩放，越大越冲出 |
| `tunnelDepth` | 否 | `0.1..20`，默认 `6` | 空间移动距离/纵深 |
| `motionBlur` | 否 | `0..1`，默认 `0.55` | 速度拖影强度 |
| `twistDegrees` | 否 | `-360..360` 度，默认 `0` | 正负决定扭转方向 |
| `easing` | 否 | 四种标准缓动，默认 `ease_in_out` | 控制加减速 |

## 参数选择方法与优先级

- “向前冲、穿过”主要提高 `endScale` 和 `tunnelDepth`；快慢先用 `duration`。
- 明确角度写入 `twistDegrees`；左右旋转按正负选择，未说旋转时保持 `0`。
- 距离、深度用 `tunnelDepth`；“从很远处出现”同时降低 `startScale`。
- 柔和表达可提高 `motionBlur` 并使用 `ease_in_out`，但模糊不是速度本身。
- 冲突时按“明确角度 > 明确距离/缩放 > 速度 > 模糊风格”处理；必须保持 `startScale < endScale`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 高速直线穿梭 | `{"duration":0.45,"startScale":0.15,"endScale":5,"tunnelDepth":12,"motionBlur":0.9,"twistDegrees":0,"easing":"ease_in"}` |
| 缓慢从远处推进 | `{"duration":2.2,"startScale":0.1,"endScale":2.2,"tunnelDepth":10,"motionBlur":0.35,"twistDegrees":0,"easing":"ease_in_out"}` |
| 顺时针扭转 90 度 | `{"duration":1,"startScale":0.25,"endScale":3,"tunnelDepth":6,"motionBlur":0.55,"twistDegrees":90,"easing":"ease_in_out"}` |
| 反向旋转并加强拖影 | `{"duration":0.8,"startScale":0.2,"endScale":4,"tunnelDepth":8,"motionBlur":0.85,"twistDegrees":-120,"easing":"ease_in"}` |
| 轻微、干净的缩放隧道 | `{"duration":1.1,"startScale":0.5,"endScale":1.8,"tunnelDepth":3,"motionBlur":0.15,"twistDegrees":0,"easing":"ease_in_out"}` |
| 使用默认穿梭 | `{"duration":0.9,"startScale":0.25,"endScale":3,"tunnelDepth":6,"motionBlur":0.55,"twistDegrees":0,"easing":"ease_in_out"}` |

## 推荐值、默认值与边界

推荐 `duration=0.5..1.4`、`startScale=0.15..0.5`、`endScale=2..5`、`tunnelDepth=4..12`。中性值为 `motionBlur=0.5`、`twistDegrees=0`；完整默认值见示例。极端缩放和深度用于短时强冲击。

模型不选择两路视频，也不输出遮罩、深度图或 camera target。当前产品若只上传静态图片，必须先由服务器静态帧源适配生成两路独立的视频帧源；不得把 `image` 直接绑定为 `video`，也不得复用同一绑定冒充前后两路。本工具不适用于真实相机 dolly、翻页、径向传送门、对象语义匹配或持续镜头运动。
