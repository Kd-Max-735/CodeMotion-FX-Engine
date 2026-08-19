# 粉笔描边 `chalk_stroke`

使用 SAM3.1 精确分割用户在上传图片中点名的对象，再在该对象轮廓上或轮廓内部生成带断续颗粒、散落粉尘、可调颜色和线宽的粉笔效果。原图始终保留为背景。对应现有特效 `fx.draw.chalkStroke`。

只输出 JSON，不附加解释或代码块：

```json
{
  "type": "chalk_stroke",
  "data": {
    "grain": 0.55,
    "scatter": 0.18,
    "opacity": 0.85,
    "progress": 0.5,
    "color": "#f4f0df",
    "strokeWidth": 0.025,
    "target": "main subject",
    "placement": "outline"
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `grain` | 是 | 数字 `0..1`，步长 `0.01` | 越大颗粒断续感越明显 |
| `scatter` | 是 | 数字 `0..1`，步长 `0.01` | 越大粉尘偏离主笔迹越多 |
| `opacity` | 是 | 数字 `0..1`，步长 `0.01` | 越大粉笔颜色越实、覆盖越强 |
| `progress` | 是 | 数字 `0..1`，步长 `0.01` | 控制描边完成比例 |
| `color` | 是 | 最多 `16` 个字符的 `#RRGGBB` 颜色 | 粉笔颜色；未指定使用暖白色 |
| `strokeWidth` | 是 | 数字 `0.002..0.2`，步长 `0.001`，相对画布 | 主粉笔笔迹宽度 |
| `target` | 是 | 字符串，最多 `80` 个英文字符 | 把用户点名对象翻译为 SAM3.1 可识别的简短英文名 |
| `placement` | 是 | `outline`、`inside` | `outline` 沿精确轮廓描边；`inside` 只在对象轮廓内部铺设粉笔颗粒 |

## 参数选择规则

- “细腻、均匀粉笔”降低 `grain`；“颗粒粗、断续”提高它。
- “边缘干净”降低 `scatter`；“粉尘飞散、松散”提高它。
- “淡、轻擦”降低 `opacity`；“厚重、反复涂写”提高它。
- 纹理密度优先用 `grain`，笔迹外的散粉用 `scatter`，整体显色强弱用 `opacity`。
- “写到几成”只映射到 `progress`，不改变前三项质感参数。
- 用户指定白色、黄色、蓝色等粉笔时转换为 `color`；“细线/粗线”分别降低/提高 `strokeWidth`。
- 必须检查随本工具附带的图片，把用户点名的可见对象翻译为英文 `target`。例如“汽车车身”使用 `car body`，“人物轮廓”使用 `person`；无法可靠识别时使用 `main subject`。
- “沿轮廓、描边、勾边”使用 `placement=outline`；“在对象内部、轮廓内涂粉笔”使用 `placement=inside`。

## 自然语言示例

| 用户表达 | `data` 参数结果 |
| --- | --- |
| 用细腻淡白粉笔沿汽车轮廓描到三成 | `{"grain":0.2,"scatter":0.05,"opacity":0.45,"progress":0.3,"color":"#f4f0df","strokeWidth":0.012,"target":"car","placement":"outline"}` |
| 在人物衣服内部铺自然粉笔颗粒 | `{"grain":0.55,"scatter":0.18,"opacity":0.85,"progress":0.5,"color":"#f4f0df","strokeWidth":0.025,"target":"person clothing","placement":"inside"}` |
| 用粗黄色粉笔勾勒小鸟轮廓 | `{"grain":0.9,"scatter":0.75,"opacity":1,"progress":0.8,"color":"#ffe36e","strokeWidth":0.06,"target":"bird","placement":"outline"}` |

## 推荐档位

| 程度 | `grain` | `scatter` | `opacity` |
| --- | ---: | ---: | ---: |
| 细腻轻淡 | `0.2` | `0.05` | `0.45` |
| 自然 | `0.55` | `0.18` | `0.85` |
| 粗粝厚重 | `0.9` | `0.7` | `1` |

默认值为 `grain=0.55`、`scatter=0.18`、`opacity=0.85`、`progress=0.5`、`color=#f4f0df`、`strokeWidth=0.025`、`target=main subject`、`placement=outline`。`grain=0`、`scatter=0` 分别表示最少颗粒断续和无额外散粉，`opacity=0` 为不可见，`progress=0` 为未绘制。

图片轮廓由服务端 SAM3.1 mask 精确提取。模型不生成 mask、路径、纹理、资源 ID 或 URL。本工具不负责创建黑板背景、生成手写文字内容，也不用于墨水扩散、笔刷遮罩或霓虹描边。

## 服务器输入槽（不进入模型 `data`）

- `source_image`（必需，`image`，单个）：前端要求用户上传一张图片，服务器保留它作为输出背景。
- `subject_mask`（必需，`mask`，单个）：服务器根据 `target` 调用 SAM3.1 从同一张授权图片派生；前端不要求第二次上传。图片、mask 和资源身份都不进入模型参数。
