# 音频波形 `waveform`

## 1. 工具作用

把服务端已授权的归一化时域采样重采样为连续折线，可与上一分析帧混合，并可生成上下镜像线。它呈现瞬时振幅，不做频段柱状聚合。

## 2. 输出要求

模型只能输出 `{"type":"waveform","data":{...}}` JSON。`data` 只包含视觉参数，不能包含音频数据、文件名、资源 ID、路径、URL 或另一个工具。

## 3. 合法 JSON 示例

```json
{"type":"waveform","data":{"sampleCount":256,"gain":1,"smoothing":0.35,"thickness":2,"horizontalScale":1,"mirror":false,"lineColor":"#F8F9FA","backgroundColor":"#212529"}}
```

## 4. 参数表

| 参数 | 类型 | 范围/选项 | 默认值 | 选择策略 |
| --- | --- | --- | --- | --- |
| `sampleCount` | 整数 | 32–512 | 256 | 输出折线采样数和细节密度 |
| `gain` | 数值 | 0.1–4 | 1 | 垂直振幅增益 |
| `smoothing` | 数值 | 0–0.95 | 0.35 | 与上一帧混合程度 |
| `thickness` | 数值 | 0.5–12 | 2 | 线条粗细 |
| `horizontalScale` | 数值 | 0.25–4 | 1 | 波形横向展开比例 |
| `mirror` | 布尔 | `true` / `false` | `false` | 是否增加上下镜像折线 |
| `lineColor` | `#RRGGBB` | 六位十六进制 | `#F8F9FA` | 波形线颜色 |
| `backgroundColor` | `#RRGGBB` | 六位十六进制 | `#212529` | 背景颜色 |

服务端另行绑定必需的 `audio_analysis` 数据槽，其中包含 1–65536 个 `waveformSamples`，可选上一帧采样。该槽不对模型开放。

## 5. 表达映射

“更多细节/更密”提高 `sampleCount`；“振幅更大”提高 `gain`；“更稳定”提高 `smoothing`，“更跟手”降低它；“更粗”提高 `thickness`；“横向拉伸/压缩”调整 `horizontalScale`；“上下对称”启用 `mirror`。

## 6. 自然语言例子

- “显示清晰的白色单线波形” → 默认附近参数，`mirror` 为 `false`。
- “语音波形更稳定” → 提高 `smoothing`，适度提高 `sampleCount`。
- “跟着瞬态快速跳动” → 低 `smoothing`、较高 `gain`。
- “做上下镜像的粉色脉冲” → `mirror` 为 `true`，设置粉色线条。
- “横向压缩到中心” → 降低 `horizontalScale`。
- “更粗但不要改变振幅” → 只提高 `thickness`。

## 7. 推荐档位

| 档位 | `sampleCount` | `gain` | `smoothing` | `thickness` |
| --- | ---: | ---: | ---: | ---: |
| 简洁 | 32–128 | 0.5–1 | 0.5–0.85 | 2–5 |
| 均衡 | 128–320 | 0.8–1.5 | 0.25–0.6 | 1–3 |
| 细致 | 320–512 | 1–2.5 | 0–0.4 | 0.5–2 |

## 8. 默认值与中性行为

默认值生成 256 点、正常振幅、轻度平滑的单条白色波形，线宽适中且不镜像。

## 9. 不能处理的内容

不能接收音频文件路径、URL 或资源 ID，不能解码音频、选择音轨或输出原始采样；不能生成频谱柱、音高识别或节拍事件，也不组合其他工具。
