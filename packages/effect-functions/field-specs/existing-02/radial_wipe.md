# 径向擦除 `radial_wipe`

围绕指定中心和起始角，在服务端绑定的 A、B 两路画面之间进行顺时针或逆时针扇形擦除。对应现有特效 `fx.transition.radialWipe`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "radial_wipe",
  "data": {
    "center": [0.5, 0.5],
    "startAngle": -90,
    "clockwise": true,
    "progress": 0.5
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `center` | 是 | 两元素数字数组 `[x,y]`；各 `0..1`，步长 `0.01` | 左上 `[0,0]`，中心 `[0.5,0.5]`，右下 `[1,1]` |
| `startAngle` | 是 | 数字 `-360..360` 度，步长 `1` | 指定扇形起始射线；顶部通常用 `-90` |
| `clockwise` | 是 | 布尔值 | 顺时针 `true`，逆时针 `false` |
| `progress` | 是 | 数字 `0..1`，步长 `0.01` | `0` 完全为 A，`1` 完全为 B |

## 参数选择规则

- 先确定中心位置；未指定使用 `[0.5,0.5]`。
- “从顶部/右侧/底部/左侧开始”推荐 `-90/0/90/180` 度。
- 用户明确顺逆时针时直接设置 `clockwise`，不要通过更改起始角模拟反向。
- 圈过多少映射到 `progress`：四分之一圈 `0.25`，半圈 `0.5`，四分之三圈 `0.75`。
- 起点由 `startAngle` 决定，旋转方向由 `clockwise` 决定，二者语义不同。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 从顶部顺时针擦过半圈 | `{"center":[0.5,0.5],"startAngle":-90,"clockwise":true,"progress":0.5}` |
| 从右侧逆时针擦过四分之一 | `{"center":[0.5,0.5],"startAngle":0,"clockwise":false,"progress":0.25}` |
| 以左上为中心，从底部顺时针转到七成 | `{"center":[0.2,0.2],"startAngle":90,"clockwise":true,"progress":0.7}` |
| 从左侧逆时针开始，刚转一点 | `{"center":[0.5,0.5],"startAngle":180,"clockwise":false,"progress":0.1}` |
| 默认方向并完成径向擦除 | `{"center":[0.5,0.5],"startAngle":-90,"clockwise":true,"progress":1}` |

## 推荐档位

| 位置/阶段 | 推荐值 |
| --- | --- |
| 中心 | `center=[0.5,0.5]` |
| 顶部起点 | `startAngle=-90` |
| 四分之一/一半/四分之三 | `progress=0.25/0.5/0.75` |
| 顺时针/逆时针 | `clockwise=true/false` |

默认值为 `center=[0.5,0.5]`、`startAngle=-90`、`clockwise=true`、`progress=0.5`。中心坐标和顶部起点是常用中性布局；`progress=0/1` 是 A/B 两端边界。`startAngle=±360` 合法但与 `0` 同向，优先输出更简单的等价角度。

A、B 两路素材由服务端绑定，不生成第二路视频、遮罩、资源 ID、路径或 URL。本工具没有柔边参数，不用于线性软擦除、液态转场、像素溶解或真实圆形扩张遮罩。
