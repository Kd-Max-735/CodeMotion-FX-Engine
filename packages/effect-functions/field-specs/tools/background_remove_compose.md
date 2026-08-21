# 去背景合成（background_remove_compose）

## 工具作用

使用服务端绑定并对齐的前景视频、matte 和背景图片完成边缘处理、溢色抑制与前后景合成。三类素材均由服务端授权，不是模型参数。

## 服务器资源要求与接入状态

- 用户上传输入：`foreground_video` 和 `background_image`。`foreground_matte` 由服务器对已授权前景视频逐帧派生并锁定，不占用第三个上传位，也不进入模型参数。
- 接入状态：**PASS**。当前服务端逐帧解码前景视频，以派生 matte 执行边缘收缩/羽化、溢色抑制和背景合成，输出真实 RGBA 帧。

## JSON 示例

```json
{"type":"background_remove_compose","data":{"edgeFeather":3,"edgeContract":1,"spillSuppression":0.75,"lightWrap":0.2,"backgroundScale":1.1,"backgroundBlur":2}}
```

## 参数字段

| 字段 | 类型与范围 | 默认值 | 推荐值 | 中性值 | 含义 |
| --- | --- | ---: | --- | ---: | --- |
| `edgeFeather` | number，0–32 像素 | 2 | 1–5 | 0 | matte 边缘柔化 |
| `edgeContract` | number，-16–16 像素 | 0 | -2–3 | 0 | 正值收缩、负值扩张 matte |
| `spillSuppression` | number，0–1 | 0.6 | 0.4–0.9 | 0 | 前景边缘溢色抑制 |
| `lightWrap` | number，0–1 | 0.15 | 0.05–0.3 | 0 | 背景光包裹前景边缘 |
| `backgroundScale` | number，0.25–4 | 1 | 0.8–1.3 | 1 | 背景缩放倍率 |
| `backgroundBlur` | number，0–64 像素 | 0 | 0–8 | 0 | 背景模糊半径 |

## 选择规则与优先级

毛发或柔软边缘适度提高 `edgeFeather`；残留底色提高 `spillSuppression`；白边通常轻微收缩 `edgeContract`。融合感使用少量 `lightWrap`，景深感可模糊背景。优先级：明确边缘问题 > 明确背景缩放/模糊 > 自然或干净风格 > 默认值。不要用参数弥补完全错误或未对齐的 matte。

## 用户表达示例

- “去掉背景并自然合成，边缘柔一点。”
- “收缩 matte 两像素，压掉绿边。”
- “背景放大到 1.2 倍并模糊 5 像素。”
- “毛发边缘保留柔和过渡。”
- “做紧致干净的边缘，不要光包裹。”
- “前景和新背景融合得更自然。”

## 不适合处理

不用于生成 matte、选择前景或背景文件、替换模型、修复严重错位素材、视频变速或多层复杂合成。
