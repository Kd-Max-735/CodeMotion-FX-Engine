# 金属材质

- toolName：`metal`
- effectId：`fx.material.metal`

## 工具作用

为服务端绑定表面提供导体 PBR 金属表现，控制粗糙度、高光、拉丝和各向异性。可选环境纹理由服务端授权绑定。

## 输出约束

只输出 JSON，`type` 必须严格等于 `metal`。禁止输出环境贴图、图层、资源地址或未声明字段。

```json
{
  "type": "metal",
  "data": {
    "roughness": 0.32,
    "specular": 0.82,
    "brushed": 0.45,
    "anisotropy": 0.55,
    "tone": "silver"
  }
}
```

## 参数字段

| 字段 | 必填 | 取值 | 默认值 | 说明 |
| --- | --- | --- | --- | --- |
| `roughness` | 是 | 0.02–1 | 0.32 | 越低越光滑、倒影越清晰 |
| `specular` | 是 | 0–1 | 0.82 | 镜面反射强度 |
| `brushed` | 否 | 0–1 | 0.45 | 拉丝纹理强度 |
| `anisotropy` | 否 | 0–1 | 0.55 | 拉丝方向高光伸展程度 |
| `tone` | 是 | `silver` / `gold` / `copper` / `dark` | `silver` | 金属基色 |

## 选择策略

“更亮”提高 `specular` 并降低 `roughness`；“更哑光”提高 `roughness`；“拉丝更明显”提高 `brushed` 与 `anisotropy`；“更平滑”降低 `brushed` 和 `roughness`；暖金属选 `gold` 或 `copper`。

## 参数优先级

先选 `tone`，再用 `roughness` 确定光滑或哑光，之后调 `specular`，最后设置 `brushed` 与 `anisotropy`。拉丝强度很低时无需把各向异性设得很高。

## 自然语言示例

1. 做光滑抛光银，反射更亮。
2. 拉丝钢质感明显一些，别太镜面。
3. 做温暖金属金色，高光集中。
4. 深色哑光金属，反射克制。
5. 铜色表面稍粗糙，保留高光。
6. 更平滑，减少拉丝方向感。

## 推荐值、默认值和中性值

默认及中性值为 `roughness=0.32`、`specular=0.82`、`brushed=0.45`、`anisotropy=0.55`、`tone=silver`。抛光金属推荐粗糙度 0.05–0.15，拉丝钢推荐 0.3–0.5。

## 非适用范围

不生成环境纹理、目标图层、资源 ID、路径或 URL；不模拟透明玻璃、发光全息、锈蚀几何或物理碰撞。
