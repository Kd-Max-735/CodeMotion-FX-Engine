# 液态置换 `liquid_displace`

## 工具作用

将服务端绑定图像按多尺度流体表面进行随时间平流的折射置换，并根据表面弯曲产生轻微焦散提亮。高黏度形成大块缓慢凝胶形变，低黏度形成更活跃的水面细节。

## JSON 输出格式

只输出以下结构的 JSON，不附加解释或代码块：

```json
{"type":"liquid_displace","data":{"viscosity":0.65,"refraction":0.32,"flowSpeed":0.4,"surfaceTension":0.55,"chromaticDispersion":0.08}}
```

## 完整参数表

| 字段 | 类型与范围 | 默认值 | 含义 |
| --- | --- | ---: | --- |
| `viscosity` | 数字 `0..1` | `0.65` | 黏度、流动时间和平滑尺度；越大越厚重缓慢，但不会关闭形变。 |
| `refraction` | 数字 `0..1.5` | `0.32` | 折射置换强度。 |
| `flowSpeed` | 数字 `-4..4` | `0.4` | 流动速度；负值反向。 |
| `surfaceTension` | 数字 `0..1` | `0.55` | 表面张力；越大轮廓越圆润聚合。 |
| `chromaticDispersion` | 数字 `0..0.5` | `0.08` | RGB 折射分离量。 |

## 表达映射与选择顺序

- “更强、更液化”优先提高 `refraction`；“更快流动”改 `flowSpeed`。
- “更黏稠、更柔和”提高 `viscosity`；“更水润活泼”降低它。
- “更圆润、更凝聚”提高 `surfaceTension`；“彩色边缘、棱彩”提高 `chromaticDispersion`。
- `viscosity` 和 `surfaceTension` 都可让效果柔和：运动拖尾过快时先提高 `viscosity`，形状边缘太碎时先提高 `surfaceTension`。
- `refraction` 与色散重叠时，先定折射形变量，再少量增加 `chromaticDispersion`。

## 自然语言示例

| 用户表达 | `data` |
| --- | --- |
| 轻柔水玻璃 | `{"viscosity":0.82,"refraction":0.18,"flowSpeed":0.18,"surfaceTension":0.75,"chromaticDispersion":0.02}` |
| 常规流动液面 | `{"viscosity":0.65,"refraction":0.32,"flowSpeed":0.4,"surfaceTension":0.55,"chromaticDispersion":0.08}` |
| 更快更稀的液化 | `{"viscosity":0.28,"refraction":0.5,"flowSpeed":1.4,"surfaceTension":0.3,"chromaticDispersion":0.06}` |
| 厚重缓慢的凝胶 | `{"viscosity":0.95,"refraction":0.4,"flowSpeed":0.08,"surfaceTension":0.9,"chromaticDispersion":0}` |
| 强烈棱彩折射 | `{"viscosity":0.4,"refraction":0.85,"flowSpeed":0.8,"surfaceTension":0.35,"chromaticDispersion":0.24}` |

## 推荐值、默认值和中性值

自然液态推荐 `viscosity=0.5..0.8`、`refraction=0.15..0.5`、`surfaceTension=0.4..0.8`。默认值见表。中性效果是 `refraction=0` 且 `chromaticDispersion=0`。

## 服务器输入行为

`primary_image` 是必需的服务器授权 RGBA 图像。`flow_map` 是可选的服务器授权纹理；省略时使用由服务器 `seed` 与时间生成的确定性无散流场。绑定存在但格式无效时拒绝，不静默回退。

## 不适用范围

不用于刚性波浪、随机湍流、镜像切片、真实流体模拟或粒子。流场纹理和源图均由服务端绑定，模型不得输出其 ID、路径、URL 或任何素材字段。
