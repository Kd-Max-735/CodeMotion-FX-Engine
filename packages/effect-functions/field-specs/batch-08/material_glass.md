# 玻璃材质

- toolName：`glass`
- effectId：`fx.material.glass`

## 工具作用

为服务端绑定表面应用介电透射玻璃表现，包含背景模糊、折射、色调、边缘高光和透明度。目标与背景图层由服务端绑定。

## 输出约束

只输出一个 JSON 对象，`type` 必须严格等于 `glass`。不得输出图层、贴图、地址、资源身份或额外文本。

```json
{
  "type": "glass",
  "data": {
    "blur": 12,
    "refraction": 0.35,
    "tint": "clear",
    "tintStrength": 0.18,
    "border": 1.5,
    "opacity": 0.72
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `blur` | 是 | 0–40 | 12 | 背景模糊强度 |
| `refraction` | 是 | 0–1 | 0.35 | 折射强度 |
| `tint` | 是 | `clear` / `cool` / `warm` / `mint` | `clear` | 玻璃色调 |
| `tintStrength` | 否 | 0–1 | 0.18 | 色调混合强度 |
| `border` | 否 | 0–10 | 1.5 | 边缘高光强度 |
| `opacity` | 否 | 0–1 | 0.72 | 玻璃本体不透明度 |

## 选择策略

“更透明”降低 `opacity` 和 `tintStrength`；“更磨砂”提高 `blur`；“更清晰”降低 `blur`；“折射更明显”提高 `refraction`；“更亮”提高 `border`；冷色科技感选 `cool`，温润选 `warm`。

## 参数优先级

先决定清透或磨砂并设置 `blur`、`opacity`，再调 `refraction`，最后设置 `tint`、`tintStrength` 与 `border`。透明度和模糊决定主体观感。

## 自然语言示例

1. 做清透玻璃，背景稍微模糊。
2. 更透明一些，边缘保留细亮线。
3. 做明显的磨砂冷色玻璃。
4. 折射强一点，像轻微棱镜。
5. 暖色玻璃，色调保持克制。
6. 背景更清晰，玻璃边框更亮。

## 推荐值、默认值和中性值

默认及中性值为 `blur=12`、`refraction=0.35`、`tint=clear`、`tintStrength=0.18`、`border=1.5`、`opacity=0.72`。清透玻璃推荐 `blur` 4–9、`opacity` 0.45–0.65。

## 非适用范围

不生成背景、图层、纹理、环境贴图、资源 ID、路径或 URL；不模拟液体、金属或全息发光，也不负责多层场景编排。
