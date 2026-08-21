# 三维文字挤出 `text_extrude_3d`

把服务端绑定并栅格化的文字挤出为带倒角、材质、灯光和透视方向的三维字形。对应现有特效 `fx.text.textExtrude3D`。

需要调用时只输出以下 JSON，不要附加解释或代码块：

```json
{
  "type": "text_extrude_3d",
  "data": {
    "depth": 0.28,
    "bevel": 0.06,
    "material": "metal",
    "light": "studio",
    "rotationX": 18,
    "rotationY": -24,
    "perspective": 0.55
  }
}
```

| `data` 字段 | 必填 | 取值 | 选择策略 |
| --- | --- | --- | --- |
| `depth` | 是 | 数字 `0..1`，默认 `0.28` | 挤出厚度；扁平文字降低，厚重立体字提高 |
| `bevel` | 是 | 数字 `0..0.25`，默认 `0.06` | 边缘倒角宽度；硬边设 `0`，柔和或高光边缘提高 |
| `material` | 是 | `matte` / `metal` / `glass`，默认 `metal` | 哑光选 `matte`，金属高光选 `metal`，透亮高光选 `glass` |
| `light` | 是 | `studio` / `rim` / `top`，默认 `studio` | 均衡棚拍光选 `studio`，轮廓边光选 `rim`，顶部照明选 `top` |
| `rotationX` | 是 | 整数 `-60..60` 度，默认 `18` | 上下倾斜；正负值改变观察方向 |
| `rotationY` | 是 | 整数 `-90..90` 度，默认 `-24` | 左右转向；正负值改变观察侧面 |
| `perspective` | 是 | 数字 `0..1`，默认 `0.55` | 透视强度；正视或平面感降低，夸张纵深提高 |

## 参数选择优先级

先用 `depth` 和 `bevel` 定几何体，再选 `material` 与 `light`，最后用 `rotationX`、`rotationY`、`perspective` 定观察方向。不要用极大旋转与极大透视重复夸张纵深；`bevel` 不应明显大于 `depth`。

| 用户提示词 | 应输出的 `data` 参数 |
| --- | --- |
| 柔和棚拍哑光立体字 | `depth=0.16, bevel=0.04, material=matte, light=studio, rotationX=12, rotationY=-18, perspective=0.4` |
| 镀铬边光文字 | `depth=0.32, bevel=0.08, material=metal, light=rim, rotationX=18, rotationY=-28, perspective=0.6` |
| 玻璃质感，从右侧观察 | `depth=0.48, bevel=0.12, material=glass, light=top, rotationX=26, rotationY=34, perspective=0.72` |
| 轻微立体、接近正面 | `depth=0.1, bevel=0.02, material=matte, light=studio, rotationX=5, rotationY=-8, perspective=0.25` |
| 厚重金属标题，强透视 | `depth=0.7, bevel=0.15, material=metal, light=rim, rotationX=30, rotationY=-45, perspective=0.85` |

`depth` 推荐值：轻微 `0.1`，中等 `0.28`，明显 `0.48`，强烈 `0.7`。`perspective` 推荐为轻微 `0.25`、中等 `0.55`、明显 `0.72`、强烈 `0.9`。默认是中等金属挤出和棚拍光；`depth=0, bevel=0, rotationX=0, rotationY=0, perspective=0` 最接近平面中性状态。

文字内容、字体、字形覆盖、纹理和时间进度由服务端绑定。本工具不加载三维模型、不选择字体、不生成纹理、阴影系统或通用三维场景，也不要输出资源 ID、文件路径或 URL。

## 服务器输入槽（不进入模型 `data`）

- `text_raster`（必需，`data`，单个）：服务端根据真实文字和 3D 字体生成字形几何、覆盖与像素。图片上传模式下，服务器从已授权图片派生带透明间隔和有效字形覆盖的文字单元代理，挤出的是这些文字单元而不是整张矩形图片；图片身份不进入模型参数。缺失时必须停止执行。
