# 纹理叠加

- toolName：`texture_overlay`
- effectId：`fx.composite.textureOverlay`

## 工具作用

将服务端授权纹理叠加到服务端绑定图层，处理混合模式、透明度、缩放、移动和预乘 Alpha。纹理与图层身份不进入模型参数。

## 输出约束

只输出 JSON，`type` 必须严格等于 `texture_overlay`。不要输出纹理信息、图层信息、地址或解释。

```json
{
  "type": "texture_overlay",
  "data": {
    "blendMode": "overlay",
    "opacity": 0.45,
    "scale": 1,
    "motion": 0,
    "motionAngle": 0,
    "premultipliedAlpha": true
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `blendMode` | 是 | `normal` / `multiply` / `screen` / `overlay` / `soft_light` | `overlay` | 纹理混合算法 |
| `opacity` | 是 | 0–1 | 0.45 | 纹理有效透明度 |
| `scale` | 否 | 0.05–20 | 1 | 纹理采样比例 |
| `motion` | 否 | -5–5 | 0 | 纹理移动速度和方向符号 |
| `motionAngle` | 否 | -180–180 度 | 0 | 移动方向角 |
| `premultipliedAlpha` | 否 | 布尔值 | `true` | 是否输出预乘 Alpha |

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `base_layer` | `data` | 是 | 服务端解析并锁定的基础图层采样 |
| `overlay_texture` | `texture` | 是 | 服务端授权、解码并锁定的叠加纹理 |

## 选择策略

“更透明”降低 `opacity`；“更明显”提高 `opacity`；“更亮”选 `screen`，增加对比选 `overlay`，压暗选 `multiply`，柔和融合选 `soft_light`；“更快”提高 `motion` 绝对值；纹理更细密可提高 `scale`。

## 参数优先级

先选 `blendMode`，再定 `opacity`，随后调整 `scale` 与移动。除非下游明确需要直通 Alpha，否则保持 `premultipliedAlpha=true`，避免透明边缘色晕。

## 自然语言示例

1. 叠一层柔和纸纹，透明一些。
2. 用正片叠底做浓重墨理，不要移动。
3. 颗粒纹理缓慢向右上方漂动。
4. 用滤色让纹理更亮，强度适中。
5. 纹理更细密，移动速度再快一点。
6. 柔光混合并保持预乘透明边缘。

## 推荐值、默认值和中性值

默认及中性值为 `blendMode=overlay`、`opacity=0.45`、`scale=1`、`motion=0`、`motionAngle=0`、`premultipliedAlpha=true`。自然材质通常推荐透明度 0.2–0.5。

## 非适用范围

不生成、选择或定位纹理与图层，不输出资源 ID、路径或 URL；不负责遮罩、置换贴图、多层合成编排或客户端渲染。
