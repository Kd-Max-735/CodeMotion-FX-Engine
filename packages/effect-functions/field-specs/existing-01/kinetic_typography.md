# 动感排版 `kinetic_typography`

按数值节拍图和缩放图驱动服务端绑定文字的单元缩放与布局脉冲。对应现有特效 `fx.text.kineticTypography`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "kinetic_typography",
  "data": {
    "layoutMode": "grid",
    "beatMap": "0,0.5,1",
    "scaleMap": "0.8,1.2,1",
    "strength": 0.35
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `layoutMode` | 是 | `grid` / `radial` / `stack`，默认 `grid` | 规则单元选 `grid`，中心扩散选 `radial`，层叠节奏选 `stack` |
| `beatMap` | 是 | 最长 4096 字符的逗号分隔有限数字串，默认 `0,0.5,1` | 描述随进度采样的节拍强弱；至少写一个数字，不得为空 |
| `scaleMap` | 是 | 最长 4096 字符的逗号分隔有限数字串，默认 `0.8,1.2,1` | 描述随进度采样的基础缩放；与 `beatMap` 使用相近节点数更易预测 |
| `strength` | 是 | 数字 `0..2`，步长 `0.01`，默认 `0.35` | 控制布局脉冲和缩放起伏的附加强度 |

## 参数选择优先级

`scaleMap` 定义主要尺寸走势，`beatMap` 定义节拍调制，`strength` 只放大或减弱附加起伏。不要同时把 `scaleMap` 写成极端值并把 `strength` 拉满；用户未给节拍细节时保留两张默认图。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 规则网格中等律动 | `layoutMode=grid, beatMap="0,0.5,1", scaleMap="0.8,1.2,1", strength=0.35` |
| 从中心向外有节拍地放大 | `layoutMode=radial, beatMap="0,1,0.4,1", scaleMap="0.7,1.3,1", strength=0.5` |
| 层叠文字轻微呼吸 | `layoutMode=stack, beatMap="0,0.3,0", scaleMap="0.95,1.05,1", strength=0.15` |
| 三个重拍，缩放更强 | `layoutMode=grid, beatMap="1,0,1,0,1", scaleMap="0.7,1.4,0.8,1.3,1", strength=0.8` |
| 保持尺寸，只保留很弱的布局律动 | `layoutMode=grid, beatMap="0", scaleMap="1", strength=0.1` |

`strength` 推荐值：轻微 `0.15`，中等 `0.35`，明显 `0.7`，强烈 `1.2`。默认是网格布局、三节点节拍与 `0.8→1.2→1` 的缩放走势；`scaleMap="1", beatMap="0", strength=0` 是中性设置。

文字、字体和音频均由服务端绑定；`beatMap` 是数字参数串，不是音频文件或资源。工具不分析音乐、不生成歌词、不改变文字内容，也不要输出音频 ID、字体、路径或 URL。
