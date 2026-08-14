# 故障切片（glitch_slice）

## 效果说明

把画面划分为水平或垂直切片，按确定性种子选择部分切片并整体错位，同时加入有限的红蓝通道抖动。它保留切片结构，不是逐像素随机噪声。

## 输出要求

只输出 JSON，不附加解释。顶层只能包含 `type` 和 `data`，`type` 必须精确为 `glitch_slice`。不得输出素材、路径、URL、纹理或资源 ID。

```json
{"type":"glitch_slice","data":{"sliceSize":10,"displacement":32,"density":0.48,"direction":"horizontal","channelJitter":5,"seedOffset":120,"mix":0.85}}
```

## 模型参数字段

| 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `sliceSize` | 否 | 1–64，整数 | 小值产生密集细切片，大值产生粗块撕裂 |
| `displacement` | 是 | 0–160，整数 | 切片最大错位像素数 |
| `density` | 否 | 0–1，步长 0.01 | 被激活切片的比例 |
| `direction` | 否 | `horizontal` / `vertical` | 水平切片左右错位，垂直切片上下错位 |
| `channelJitter` | 否 | 0–24，整数 | 激活切片内红蓝通道附加偏移 |
| `seedOffset` | 否 | 0–100000，整数 | 在同一服务器种子下切换稳定图案 |
| `mix` | 否 | 0–1，步长 0.01 | 故障结果混合比例 |

服务器输入：`source_frame`、帧号和基础种子由服务器提供，均不属于模型 JSON。

## 参数选择规则

1. “细碎抖动”用小切片、小位移、低密度；“画面撕裂”提高三者。
2. 先选切片方向，再解释位移方向；不要把 `direction` 当作运动向量。
3. 只需要几何撕裂时将 `channelJitter` 降为 0。
4. `seedOffset` 仅用于换图案，不表示随机资源或用户 ID。
5. 跨帧残留应使用 `datamosh`，亮度排序拖影应使用 `pixel_sort`。

## 自然语言示例

1. “偶尔有几条水平信号跳动”：水平、小切片、低密度、低位移。
2. “画面被粗大的横条撕开”：水平、大切片、高位移和中高密度。
3. “纵向列块上下错位”：垂直方向，切片中大，位移中高。
4. “只要切片，不要彩色边”：`channelJitter=0`。
5. “故障结构不变但换一种分布”：只改 `seedOffset`。
6. “强烈广播故障并带红蓝抖动”：中等切片、高密度、高位移和通道抖动。

## 推荐档位

| 档位 | sliceSize | displacement | density |
| --- | --- | --- | --- |
| 轻 | 4 | 6 | 0.18 |
| 中 | 8 | 18 | 0.35 |
| 强 | 20 | 70 | 0.75 |

## 默认值和中性值

默认值：`sliceSize=8`、`displacement=18`、`density=0.35`、`direction=horizontal`、`channelJitter=3`、`seedOffset=0`、`mix=0.85`。中性值可用 `displacement=0`、`density=0` 或 `mix=0`。

## 不适用范围

不适合真实视频压缩残帧、逐行扫描同步、像素亮度排序或普通颗粒。没有跨帧输入，因此不能替代数据错帧。
