# 数值滚动

- toolName：`number_counter`
- effectId：`fx.data.numberCounter`

## 工具作用

在用户上传的一张图片上生成确定性的数值滚动和进度条。模型根据自然语言选择起止值、完成时长、颜色和大小，并查看随工具附带的图片，把用户描述的位置转换为归一化坐标；服务端负责逐帧插值和绘制。

## 输出约束

只输出 JSON，`type` 必须严格等于 `number_counter`。`data` 中不得出现图片、资源 ID、路径、URL 或其他资源信息。

```json
{
  "type": "number_counter",
  "data": {
    "format": "integer",
    "duration": 1.2,
    "easing": "ease_out",
    "fromValue": 0,
    "toValue": 100,
    "numberColor": "#68EEFF",
    "progressColor": "#FF58AE",
    "trackColor": "#364658",
    "positionX": 0.5,
    "positionY": 0.5,
    "size": 0.18,
    "barWidth": 0.58
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `format` | 是 | `integer` / `decimal_1` / `decimal_2` / `percent` | `integer` | 显示格式 |
| `duration` | 是 | 0.1–30 秒 | 1.2 | 完成滚动所需时间 |
| `easing` | 否 | `linear` / `ease_out` / `smooth` | `ease_out` | 数值推进节奏 |
| `fromValue` | 是 | -1000000000–1000000000 | 0 | 起始数值 |
| `toValue` | 是 | -1000000000–1000000000 | 100 | 完成时的目标数值 |
| `numberColor` | 是 | `#RRGGBB` | `#68EEFF` | 数字颜色 |
| `progressColor` | 是 | `#RRGGBB` | `#FF58AE` | 已完成进度条颜色 |
| `trackColor` | 是 | `#RRGGBB` | `#364658` | 未完成轨道颜色 |
| `positionX` | 是 | 0–1 | 0.5 | 数字中心横向坐标，0 为左、1 为右 |
| `positionY` | 是 | 0–1 | 0.5 | 数字中心纵向坐标，0 为上、1 为下 |
| `size` | 是 | 0.05–0.8 | 0.18 | 数字高度相对画面高度的比例 |
| `barWidth` | 是 | 0.05–0.95 | 0.58 | 进度条宽度相对画面宽度的比例 |

## 服务器输入

| inputSlot | kind | 必需 | 说明 |
| --- | --- | --- | --- |
| `source_image` | `image` | 是 | 用户上传并由服务端授权的背景图片；模型只接收受控视觉副本用于定位 |

## 选择策略

“更快”降低 `duration`；“完成 6 秒的滚动”必须设置 `duration=6`，服务端会在第 6 秒精确到达 `toValue`。“更平滑”选 `smooth`；“匀速”选 `linear`。根据图片识别用户指定的空白区域或对象附近位置，输出 `positionX/positionY`，不得始终使用画面中心。

## 参数优先级

先确定 `fromValue/toValue` 和 `format`，再确定 `duration/easing`，随后按用户描述选择颜色与大小，最后查看图片定位。坐标以完整图片左上角为 `(0,0)`、右下角为 `(1,1)`；渲染器会在边缘自动收拢，避免文字和进度条溢出。

## 自然语言示例

1. 在图片中心用青色数字从 0 滚到 100，6 秒正好完成。
2. 在汽车上方显示从 20 到 80 的整数，蓝色数字、黄色进度条。
3. 在右下角保留两位小数，平滑计数两秒。
4. 在标题下方做一个从 0 到 100 的一秒百分比增长。
5. 数值匀速变化，不要缓入缓出，进度条宽一些。
6. 左上角显示较小的红色数字，前面变化快，接近终点时慢下来。

## 推荐值、默认值和中性值

默认值与 JSON 示例完全一致。`duration` 是到达终值所需秒数；`positionX=0.5, positionY=0.5` 为居中；`size=0.18, barWidth=0.58` 为中等尺寸。信息大字报常用 0.8–1.5 秒，用户明确视频节奏时必须采用其时长。

## 非适用范围

不生成或修改背景素材，不输出图片、资源 ID、图层、字体、路径或 URL；不负责抓取实时数据，也不执行公式或任意代码。上传图片只由服务端绑定并作为导出背景，Tool Call JSON 只包含上述参数。
