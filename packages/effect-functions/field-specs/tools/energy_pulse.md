# 能量脉冲 `energy_pulse`

在用户上传的一张基础图片上，以指定中心连续发射径向能量脉冲，控制半径、衰减宽度、发射次数和完整动画持续时间。对应现有特效 `fx.light.energyPulse`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "energy_pulse",
  "data": {
    "center": [0.5, 0.5],
    "radius": 0.34,
    "falloff": 0.2,
    "rings": 4,
    "duration": 3,
    "centerMode": "coordinates"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `center` | 是 | 两元素数字数组 `[x,y]`；各 `0..1`，步长 `0.01` | 左上 `[0,0]`，中心 `[0.5,0.5]`，右下 `[1,1]` |
| `radius` | 是 | 数字 `0..2`，步长 `0.01`，相对画布 | 越大脉冲环扩张范围越大 |
| `falloff` | 是 | 数字 `0.001..1`，步长 `0.005` | 越大环带越宽、衰减越柔和 |
| `rings` | 是 | 数字 `1..32`，步长 `1` | 控制一次视频内依次发射的脉冲次数，按次数词选择整数 |
| `duration` | 是 | 数字 `0.1..60` 秒，步长 `0.1`，默认 `3` | 从第一圈发射到最后一圈消散的完整脉冲动画时长；不是导出视频总时长 |
| `centerMode` | 是 | 枚举 `coordinates` / `brightest` / `subject_center` / `subject_left` / `subject_right` / `subject_top` / `subject_bottom` | 坐标、局部最亮区域质心或主体边界锚点；非坐标模式由服务器分析授权图片 |

## 参数选择规则

- 位置词先映射 `center`；未指定时使用画面中心。
- “小范围/冲出画面”优先调 `radius`；`radius>1` 可让范围超出归一化画布。
- “锐利冲击波”降低 `falloff`；“宽厚、柔和能量带”提高它。
- “发射一次/连续发射多次”直接映射 `rings`；次数增加会缩短相邻脉冲的时间间隔，不会把它们压成同一圈的纹理。
- 用户说“脉冲持续 N 秒”时设置 `duration=N`。`duration` 是多轮脉冲的完整发射窗口，每一轮保持自然扩散速度，不会因总时长增加而整体变慢；完成后底图保持不变，不循环。
- 本工具 Schema 没有 `progress` 字段，不要生成它。
- 本工具收到上传图片时，模型会在服务端受控地读取这一张图片。用户点名“太阳中心、车灯中心、人物手掌”等可见目标时，必须根据图片定位该目标的视觉中心，使用 `centerMode=coordinates`，并将坐标写入 `center=[x,y]`；坐标以左上角为原点，横向和纵向均为 `0..1`。用户直接给出“左上、画面中央、横向 70% 纵向 30%”时同样使用 `coordinates`。
- 仅当目标表述是“最亮处”而非具体语义对象，或视觉输入不可用时使用 `brightest`；服务器会围绕最显著亮点执行两轮局部亮区质心收敛。主体中心或边界的降级定位使用对应 `subject_*`。图片身份、路径和内容不得进入 `data`。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 从中心发出一个锐利小脉冲，持续 2 秒 | `{"center":[0.5,0.5],"radius":0.18,"falloff":0.04,"rings":1,"duration":2,"centerMode":"coordinates"}` |
| 默认连续发射四次能量脉冲 | `{"center":[0.5,0.5],"radius":0.34,"falloff":0.2,"rings":4,"duration":3,"centerMode":"coordinates"}` |
| 从左下角连续发出六次柔和脉冲，持续 5 秒 | `{"center":[0.2,0.8],"radius":0.6,"falloff":0.4,"rings":6,"duration":5,"centerMode":"coordinates"}` |
| 从图片中的太阳中心连续发出八次脉冲，持续 5 秒 | 根据图片定位太阳中心，设置 `center=[x,y]`、`centerMode="coordinates"`，并设置 `radius=0.6, falloff=0.16, rings=8, duration=5` |
| 右上角快速连续发射十二次冲击波 | `{"center":[0.8,0.2],"radius":0.8,"falloff":0.12,"rings":12,"duration":2,"centerMode":"coordinates"}` |
| 超出画面的宽厚双环 | `{"center":[0.5,0.5],"radius":1.4,"falloff":0.55,"rings":2,"duration":3,"centerMode":"coordinates"}` |

## 推荐档位

| 程度 | `radius` | `falloff` | `rings` |
| --- | ---: | ---: | ---: |
| 小而锐利 | `0.18` | `0.04` | `1..2` |
| 标准 | `0.34` | `0.2` | `4` |
| 大而密集 | `0.8` | `0.4` | `8..12` |

默认值为 `center=[0.5,0.5]`、`radius=0.34`、`falloff=0.2`、`rings=4`、`duration=3`、`centerMode=coordinates`。中心坐标是位置中性值；`radius=0` 是零基础半径，`falloff=0.001` 是最锐边界，`rings=1` 是单环。最大 `radius=2`、`falloff=1`、`rings=32`、`duration=60` 仅用于极端范围、极宽、极密或长时间效果。

源画面和动画时间由服务端绑定，不生成图片、视频、纹理、资源 ID、路径或 URL。`duration` 只控制脉冲动画时间，导出视频总时长由外部导出设置控制。本工具不用于镜头鬼影、扫描光束或霓虹轮廓。
