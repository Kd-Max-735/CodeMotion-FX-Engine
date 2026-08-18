# 全息投影材质

- toolName：`hologram`
- effectId：`fx.material.hologram`

## 工具作用

为服务端绑定表面生成自发光全息投影表现，包含扫描线、闪烁、故障偏移和深度视差。深度图必须由服务端授权绑定；缺失时安全拒绝。

## 输出约束

只输出一个合法 JSON 对象，`type` 必须严格等于 `hologram`。不得输出深度图、图层、资源身份、地址或解释。

```json
{
  "type": "hologram",
  "data": {
    "scanline": 0.65,
    "flicker": 0.18,
    "glitch": 0.12,
    "depth": 0.4,
    "brightness": 1.2,
    "opacity": 0.72,
    "colorMode": "cyan"
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `scanline` | 是 | 0–1 | 0.65 | 扫描线调制强度 |
| `flicker` | 是 | 0–1 | 0.18 | 随时间闪烁强度 |
| `glitch` | 是 | 0–1 | 0.12 | 故障横向偏移概率与幅度 |
| `depth` | 是 | 0–1 | 0.4 | 深度视差强度 |
| `brightness` | 否 | 0–3 | 1.2 | 自发光亮度 |
| `opacity` | 否 | 0–1 | 0.72 | 投影不透明度 |
| `colorMode` | 否 | `cyan` / `green` / `magenta` | `cyan` | 发光色模式 |

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `source_image` | `image` | 是 | 用户上传并由服务端授权解码的一张投影图片 |
| `target_layer` | `data` | 是 | 服务端从投影图片派生并锁定的材质表面，不占上传位 |
| `depth_map` | `depth-map` | 是 | 服务端从投影图片亮度派生并锁定的深度采样，不占上传位 |

## 选择策略

“更亮”提高 `brightness`；“更透明”降低 `opacity`；“更稳定、更平滑”降低 `flicker` 与 `glitch`；“故障更强”提高两者；“层次更深”提高 `depth`；扫描感更明显则提高 `scanline`。

## 参数优先级

先确定 `colorMode` 与 `brightness`，再调 `scanline` 和 `depth` 建立主体，最后用 `flicker`、`glitch` 增加不稳定感并以 `opacity` 收尾。故障不应压过可读性。

## 自然语言示例

1. 做稳定清晰的青色全息投影。
2. 故障闪烁更强，偏洋红色。
3. 扫描线明显，但抖动保持克制。
4. 投影更透明，深度层次更强。
5. 绿色全息画面更亮一些。
6. 减少故障和闪烁，让运动更平滑。

## 推荐值、默认值和中性值

默认及中性值为 `scanline=0.65`、`flicker=0.18`、`glitch=0.12`、`depth=0.4`、`brightness=1.2`、`opacity=0.72`、`colorMode=cyan`。稳定展示建议故障低于 0.15。

## 非适用范围

不生成深度图、模型、纹理、图层、资源 ID、路径或 URL；没有服务端授权深度图时不执行；不提供真实体积光、玻璃折射、金属 PBR 或多工具合成。
