import {
  EFFECT_TOOL_REGISTRY,
  validateAndNormalizeEffectEnvelope
} from "@codemotion/effect-functions";

export interface SelfCheckParameterInformationItem {
  readonly label: string;
  readonly value: unknown;
}

export type SelfCheckParameterInformation = Readonly<Record<string, SelfCheckParameterInformationItem>>;

type ImportantParameter = readonly [name: string, label: string];

const IMPORTANT_PARAMETERS = Object.freeze({
  aura_field: [["intensity", "光场强度"], ["centerX", "中心横坐标"], ["centerY", "中心纵坐标"],
    ["radius", "光场半径"], ["hue", "主色相"], ["pulseRate", "呼吸频率"]],
  background_remove_compose: [["edgeFeather", "边缘羽化"], ["edgeContract", "边缘收缩"],
    ["spillSuppression", "溢色抑制"], ["lightWrap", "光线包裹"], ["backgroundBlur", "背景模糊"]],
  beat_pulse: [["sensitivity", "节拍灵敏度"], ["decay", "脉冲衰减"], ["amount", "脉冲幅度"],
    ["targetProperty", "响应属性"]],
  blend: [["mode", "混合模式"], ["opacity", "图层不透明度"], ["mix", "混合比例"],
    ["premultiply", "预乘透明度"]],
  blob_morph: [["noiseAmount", "形变幅度"], ["noiseScale", "形变尺度"], ["tension", "轮廓张力"],
    ["speed", "形变速度"], ["rotation", "旋转角度"]],
  bounce: [["height", "弹跳高度"], ["gravity", "重力"], ["bounces", "弹跳次数"],
    ["damping", "弹跳阻尼"], ["squash", "挤压幅度"]],
  brush_reveal: [["size", "笔刷尺寸"], ["roughness", "笔刷粗糙度"], ["progress", "揭示进度"]],
  chalk_stroke: [["grain", "粉笔颗粒"], ["scatter", "散粉程度"], ["opacity", "描边不透明度"],
    ["progress", "描边进度"], ["color", "描边颜色"], ["strokeWidth", "描边宽度"]],
  character_cascade: [["stagger", "字符间隔"], ["axis", "级联方向"], ["offset", "字符位移"],
    ["text", "文字内容"], ["fontSize", "字号"], ["positionX", "横向位置"], ["positionY", "纵向位置"],
    ["color", "文字颜色"]],
  chart_reveal: [["chartType", "图表类型"], ["duration", "揭示时长"], ["stagger", "项目间隔"],
    ["easing", "缓动方式"], ["direction", "揭示方向"], ["labels", "项目名称"], ["values", "项目数值"],
    ["colors", "项目颜色"]],
  chromatic_aberration: [["amount", "色差强度"], ["radial", "径向程度"], ["angle", "色差方向"],
    ["falloff", "边缘衰减"], ["mix", "混合比例"]],
  color_grade: [["exposure", "曝光"], ["contrast", "对比度"], ["saturation", "饱和度"],
    ["temperature", "色温"], ["tint", "色调偏移"], ["gamma", "伽马"], ["gain", "增益"], ["mix", "调色混合比例"]],
  dash_flow: [["dashLength", "虚线段长度"], ["gapLength", "虚线间隙"], ["speed", "流动速度"],
    ["direction", "流动方向"], ["curve", "路径弯曲度"], ["color", "虚线颜色"], ["thickness", "虚线宽度"]],
  datamosh: [["blockSize", "块尺寸"], ["carry", "帧延续强度"], ["motionX", "横向错位"],
    ["motionY", "纵向错位"], ["corruption", "损坏强度"], ["smear", "拖抹强度"]],
  depth_of_field: [["focusDepth", "焦点深度"], ["focusRange", "清晰范围"], ["blurRadius", "模糊半径"],
    ["bokehBoost", "散景增强"], ["edgePreservation", "边缘保留"]],
  directional_blur: [["angle", "模糊角度"], ["distance", "模糊距离"], ["samples", "采样数量"],
    ["edgeMode", "边缘模式"]],
  displacement_map: [["xAmount", "横向置换量"], ["yAmount", "纵向置换量"], ["channel", "置换通道"]],
  dolly: [["direction", "推拉方向"], ["distance", "移动距离"], ["heightOffset", "高度偏移"],
    ["duration", "镜头时长"], ["verticalFovDegrees", "垂直视场角"], ["easing", "缓动方式"]],
  dolly_zoom: [["direction", "推拉方向"], ["travelDistance", "移动距离"],
    ["initialTargetDistance", "初始主体距离"], ["initialFovDegrees", "初始视场角"], ["duration", "镜头时长"],
    ["easing", "缓动方式"]],
  echo_trail: [["trailCount", "拖影数量"], ["spacing", "拖影间隔"], ["decay", "拖影衰减"],
    ["offsetX", "横向偏移"], ["offsetY", "纵向偏移"], ["blendMode", "混合模式"]],
  elastic: [["amplitude", "弹性幅度"], ["period", "弹性周期"], ["decay", "弹性衰减"], ["axis", "弹性方向"]],
  energy_pulse: [["center", "脉冲中心"], ["radius", "脉冲半径"], ["falloff", "边缘衰减"],
    ["rings", "脉冲环数"], ["duration", "脉冲时长"], ["centerMode", "中心定位模式"]],
  fade: [["from", "起始透明度"], ["to", "结束透明度"], ["duration", "过渡时长"], ["easing", "缓动方式"]],
  film_grain: [["amount", "颗粒强度"], ["size", "颗粒尺寸"], ["monochrome", "单色颗粒"],
    ["response", "亮度响应"], ["temporal", "时序变化"]],
  float: [["axis", "漂浮方向"], ["range", "漂浮幅度"], ["frequency", "漂浮频率"], ["phase", "起始相位"]],
  fractal: [["iterations", "迭代次数"], ["centerX", "中心横坐标"], ["centerY", "中心纵坐标"],
    ["zoom", "缩放"], ["rotation", "旋转角度"], ["speed", "运动速度"], ["strength", "分形强度"],
    ["insideColor", "内部颜色"], ["outsideColor", "外部颜色"]],
  gaussian_blur: [["radius", "模糊半径"], ["passes", "模糊遍数"], ["edgeMode", "边缘模式"],
    ["alphaAware", "透明度感知"]],
  glass: [["blur", "玻璃模糊"], ["refraction", "折射强度"], ["tintColor", "玻璃色调"],
    ["tintStrength", "色调强度"], ["border", "边缘宽度"], ["opacity", "玻璃不透明度"]],
  glitch_slice: [["sliceSize", "切片尺寸"], ["displacement", "切片错位"], ["density", "切片密度"],
    ["direction", "切片方向"], ["channelJitter", "通道抖动"], ["mix", "混合比例"]],
  gradient_flow: [["intensity", "渐变强度"], ["scale", "渐变尺度"], ["speed", "流动速度"],
    ["angle", "流动角度"], ["phase", "起始相位"], ["palette", "渐变色板"]],
  handheld: [["intensity", "手持强度"], ["frequency", "晃动频率"], ["translationJitter", "平移抖动"],
    ["rotationJitterDegrees", "旋转抖动"], ["smoothing", "运动平滑度"]],
  handwriting: [["text", "书写文字"], ["fontSize", "字号"], ["positionX", "横向位置"],
    ["positionY", "纵向位置"], ["color", "笔迹颜色"], ["pressure", "笔压"],
    ["speedVariation", "速度变化"], ["progress", "书写进度"]],
  hologram: [["scanline", "扫描线强度"], ["flicker", "闪动强度"], ["glitch", "故障强度"],
    ["depth", "全息深度"], ["brightness", "投影亮度"], ["opacity", "投影不透明度"], ["colorMode", "颜色模式"]],
  image_depth_parallax: [["startTime", "开始时间"], ["duration", "运动时长"], ["motionX", "横向运动"],
    ["motionY", "纵向运动"], ["depthScale", "深度强度"], ["cameraDistance", "相机距离"],
    ["edgeExpansion", "边缘扩展"], ["easing", "缓动方式"]],
  kaleidoscope: [["segments", "镜像分段数"], ["rotation", "旋转角度"], ["centerX", "中心横坐标"],
    ["centerY", "中心纵坐标"], ["zoom", "缩放"], ["mirror", "镜像开关"], ["rotationSpeed", "旋转速度"]],
  ken_burns: [["duration", "镜头时长"], ["startScale", "起始缩放"], ["endScale", "结束缩放"],
    ["startCenterX", "起始中心横坐标"], ["startCenterY", "起始中心纵坐标"],
    ["endCenterX", "结束中心横坐标"], ["endCenterY", "结束中心纵坐标"], ["easing", "缓动方式"],
    ["motionMode", "运动模式"]],
  kinetic_typography: [["layoutMode", "排版模式"], ["strength", "跳动强度"], ["jumpDuration", "跳动时长"],
    ["text", "文字内容"], ["fontSize", "字号"], ["positionX", "横向位置"], ["positionY", "纵向位置"],
    ["color", "文字颜色"]],
  lens_flare: [["source", "光源位置"], ["ghosts", "鬼影数量"], ["streak", "光条强度"], ["chromatic", "色散强度"]],
  liquid_displace: [["viscosity", "液体黏度"], ["refraction", "折射强度"], ["flowSpeed", "流动速度"],
    ["surfaceTension", "表面张力"], ["chromaticDispersion", "色散强度"]],
  marker_stroke: [["target", "描边目标"], ["width", "笔触宽度"], ["opacity", "笔触不透明度"],
    ["bleed", "渗色程度"], ["edgeRoughness", "边缘粗糙度"], ["color", "笔触颜色"],
    ["curve", "笔触弯曲度"]],
  mask_reveal: [["progress", "显现进度"], ["feather", "遮罩羽化"], ["invert", "反转遮罩"],
    ["shape", "遮罩形状"], ["motion", "遮罩运动"], ["centerX", "中心横坐标"], ["centerY", "中心纵坐标"],
    ["size", "遮罩尺寸"], ["duration", "显现时长"]],
  motion_blur: [["shutterAngle", "快门角度"], ["samples", "采样数量"], ["velocity", "运动速度"],
    ["centered", "居中采样"]],
  neon_glow: [["color", "霓虹颜色"], ["radius", "光晕半径"], ["intensity", "发光强度"],
    ["flicker", "闪动强度"], ["target", "发光目标"]],
  neon_trace: [["progress", "追踪进度"], ["glowRadius", "光晕半径"], ["intensity", "发光强度"],
    ["trailLength", "拖尾长度"], ["pulseRate", "脉冲频率"], ["hue", "霓虹色相"], ["coreWidth", "光芯宽度"]],
  noise_field: [["gridSize", "网格尺寸"], ["scale", "噪声尺度"], ["octaves", "噪声层数"],
    ["persistence", "层级保持度"], ["speed", "噪声速度"], ["lowColor", "低值颜色"], ["highColor", "高值颜色"]],
  number_counter: [["format", "数字格式"], ["duration", "计数时长"], ["easing", "缓动方式"],
    ["fromValue", "起始数值"], ["toValue", "结束数值"], ["numberColor", "数字颜色"],
    ["positionX", "横向位置"], ["positionY", "纵向位置"], ["size", "数字尺寸"]],
  onset_trigger: [["threshold", "触发阈值"], ["cooldown", "触发冷却"], ["retriggerMode", "重复触发模式"],
    ["strength", "触发强度"]],
  page_turn: [["direction", "翻页方向"], ["duration", "翻页时长"], ["curlRadius", "卷曲半径"],
    ["perspective", "透视强度"], ["shadowStrength", "阴影强度"], ["easing", "缓动方式"]],
  paint_on: [["duration", "绘制时长"], ["coverage", "绘制覆盖率"], ["strokeOrder", "笔触顺序"],
    ["brushShape", "笔刷形状"], ["brushSize", "笔刷尺寸"], ["hardness", "笔刷硬度"],
    ["spacing", "笔触间距"], ["feather", "边缘羽化"]],
  particle_dissolve: [["progress", "溶解进度"], ["particleCount", "粒子数量"], ["force", "消散力度"],
    ["direction", "消散方向"], ["turbulence", "湍流强度"], ["particleSize", "粒子尺寸"], ["duration", "溶解时长"]],
  particle_emitter: [["rate", "发射速率"], ["speed", "粒子速度"], ["direction", "发射方向"],
    ["spread", "发射散布"], ["lifetime", "粒子寿命"], ["size", "粒子尺寸"], ["gravity", "重力"],
    ["positionX", "发射点横坐标"], ["positionY", "发射点纵坐标"], ["color", "粒子颜色"]],
  particle_flow_field: [["particleCount", "粒子数量"], ["fieldStrength", "流场强度"],
    ["fieldScale", "流场尺度"], ["turbulence", "湍流强度"], ["drag", "阻力"],
    ["advectionSpeed", "平流速度"], ["spawnRadius", "生成半径"]],
  particle_logo_assemble: [["target", "聚合目标"], ["particleCount", "粒子数量"], ["duration", "聚合时长"],
    ["scatterRadius", "散布半径"], ["swirl", "旋转聚合"], ["attraction", "吸引强度"],
    ["particleSize", "粒子尺寸"]],
  particle_orbit_field: [["particleCount", "粒子数量"], ["orbitStrength", "轨道强度"],
    ["tangentialSpeed", "切向速度"], ["radialDamping", "径向阻尼"], ["fieldScale", "轨道尺度"],
    ["spread", "粒子散布"], ["direction", "环绕方向"]],
  particle_snow_rain: [["mode", "降落模式"], ["density", "粒子密度"], ["fallSpeed", "下落速度"],
    ["wind", "风力"], ["turbulence", "湍流强度"], ["size", "粒子尺寸"], ["depth", "景深层次"],
    ["opacity", "粒子不透明度"]],
  particle_spark: [["count", "火花数量"], ["speed", "飞散速度"], ["spread", "飞散范围"],
    ["lifetime", "火花寿命"], ["gravity", "重力"], ["glow", "发光强度"], ["size", "火花尺寸"],
    ["burstInterval", "爆发间隔"], ["direction", "飞散方向"], ["color", "火花颜色"]],
  particle_trail: [["emissionRate", "发射速率"], ["trailLength", "拖尾长度"], ["speed", "运动速度"],
    ["width", "拖尾宽度"], ["fade", "拖尾衰减"], ["waviness", "轨迹波动"],
    ["trajectory", "轨迹类型"], ["direction", "运动方向"], ["hue", "拖尾色相"]],
  path_morph: [["progress", "变形进度"], ["duration", "变形时长"], ["direction", "变形方向"],
    ["strength", "变形强度"], ["blur", "变形模糊"], ["normalize", "路径归一化"]],
  path_trim: [["target", "修剪目标"], ["mode", "修剪模式"], ["duration", "修剪时长"],
    ["direction", "修剪方向"], ["strokeWidth", "描边宽度"], ["strokeColor", "描边颜色"]],
  pixel_dissolve: [["grid", "像素网格"], ["order", "溶解顺序"], ["seed", "随机种子"],
    ["progress", "溶解进度"], ["duration", "溶解时长"]],
  pixel_sort: [["direction", "排序方向"], ["lowThreshold", "低阈值"], ["highThreshold", "高阈值"],
    ["minimumRun", "最短排序段"], ["order", "排序次序"], ["mix", "混合比例"]],
  portal: [["duration", "传送时长"], ["innerRadius", "内圈半径"], ["outerRadius", "外圈半径"],
    ["swirlTurns", "旋涡圈数"], ["edgeSoftness", "边缘柔和度"], ["glowStrength", "发光强度"],
    ["easing", "缓动方式"]],
  radial_blur: [["center", "模糊中心"], ["strength", "模糊强度"], ["mode", "径向模式"], ["samples", "采样数量"]],
  radial_wipe: [["center", "擦除中心"], ["startAngle", "起始角度"], ["clockwise", "顺时针方向"],
    ["progress", "擦除进度"], ["duration", "擦除时长"]],
  rgb_split: [["distance", "通道分离距离"], ["angle", "分离角度"], ["redScale", "红通道比例"],
    ["blueScale", "蓝通道比例"], ["mode", "分离模式"], ["mix", "混合比例"]],
  rotate_in: [["angle", "旋转角度"], ["pivot", "旋转轴心"], ["blur", "旋转模糊"],
    ["turns", "旋转圈数"], ["duration", "旋入时长"]],
  sacred_geometry: [["pattern", "几何图案"], ["rings", "环数"], ["symmetry", "对称数"],
    ["scale", "图案缩放"], ["rotation", "旋转角度"], ["speed", "旋转速度"],
    ["strokeColor", "线条颜色"], ["backgroundColor", "背景颜色"]],
  scale_pop: [["startScale", "起始缩放"], ["endScale", "结束缩放"], ["spring", "回弹强度"],
    ["pivot", "缩放轴心"], ["duration", "出现时长"]],
  scan_beam: [["angle", "光束角度"], ["width", "光束宽度"], ["softness", "边缘柔和度"], ["speed", "扫描速度"]],
  shake: [["intensity", "震动强度"], ["frequency", "震动频率"], ["decay", "震动衰减"], ["seedOffset", "随机偏移"]],
  sim_cloth: [["resolution", "布料分辨率"], ["clothWidth", "布面宽度"], ["stiffness", "布料刚度"],
    ["damping", "运动阻尼"], ["gravity", "重力"], ["windStrength", "风力"],
    ["solverIterations", "求解迭代次数"]],
  sim_collision_shatter: [["fragmentCount", "碎片数量"], ["impactStrength", "撞击强度"],
    ["spreadAngle", "飞散角度"], ["gravity", "重力"], ["drag", "空气阻力"], ["spin", "碎片旋转"],
    ["restitution", "反弹系数"], ["randomness", "随机程度"]],
  sim_rigid_body_2d: [["bodyCount", "刚体数量"], ["gravity", "重力"], ["restitution", "反弹系数"],
    ["friction", "摩擦力"], ["initialSpeed", "初始速度"], ["bodyRadius", "刚体半径"],
    ["solverIterations", "求解迭代次数"]],
  sim_rope: [["segmentCount", "绳索分段数"], ["ropeLength", "绳索长度"], ["gravity", "重力"],
    ["damping", "运动阻尼"], ["stiffness", "绳索刚度"], ["swingImpulse", "摆动冲量"],
    ["anchorMode", "锚点模式"], ["anchorX", "锚点横坐标"], ["anchorY", "锚点纵坐标"]],
  slide: [["direction", "划入方向"], ["distance", "移动距离"], ["overshoot", "超调幅度"],
    ["vector", "自定义方向向量"], ["duration", "划入时长"]],
  spectrum_bars: [["barCount", "频谱柱数量"], ["gain", "频谱增益"], ["smoothing", "频谱平滑度"],
    ["falloff", "回落速度"], ["logarithmic", "对数分布"], ["barColor", "频谱柱颜色"],
    ["backgroundColor", "背景颜色"]],
  text_morph: [["sourceText", "起始文字"], ["targetText", "目标文字"], ["matchMode", "字符匹配模式"],
    ["progress", "变形进度"], ["duration", "变形时长"], ["fontSize", "字号"],
    ["sourcePositionX", "起始横向位置"], ["sourcePositionY", "起始纵向位置"],
    ["targetPositionX", "目标横向位置"], ["targetPositionY", "目标纵向位置"]],
  texture_overlay: [["target", "叠加目标"], ["blendMode", "混合模式"], ["opacity", "纹理不透明度"],
    ["scale", "纹理缩放"], ["motion", "纹理运动速度"], ["motionAngle", "纹理运动角度"],
    ["premultipliedAlpha", "预乘透明度"]],
  track_matte: [["mode", "遮罩模式"], ["invert", "反转遮罩"], ["opacity", "遮罩不透明度"], ["target", "遮罩目标"]],
  turbulent_displace: [["amount", "置换强度"], ["scale", "湍流尺度"], ["complexity", "湍流复杂度"],
    ["evolutionSpeed", "演化速度"], ["anisotropy", "方向差异"], ["edgeMode", "边缘模式"]],
  typewriter: [["speed", "打字速度"], ["cursor", "光标样式"], ["wordMode", "按词显示"],
    ["cursorWidth", "光标宽度"], ["text", "文字内容"], ["fontSize", "字号"],
    ["positionX", "横向位置"], ["positionY", "纵向位置"], ["color", "文字颜色"]],
  video_freeze_frame: [["freezeAt", "冻结时间点"], ["freezeDuration", "冻结时长"],
    ["zoomScale", "冻结缩放"], ["vignette", "暗角强度"]],
  vocal_reactive_text: [["band", "响应频段"], ["mapping", "映射方式"], ["smoothing", "响应平滑度"],
    ["amount", "响应幅度"], ["baseline", "响应基线"]],
  volumetric_ray: [["density", "光束密度"], ["decay", "光束衰减"], ["exposure", "光束曝光"],
    ["weight", "光束权重"], ["lightX", "光源横坐标"], ["lightY", "光源纵坐标"],
    ["color", "光束颜色"], ["flowSpeed", "内部流动速度"], ["beamWidth", "光束宽度"]],
  wave_path: [["amplitude", "波动幅度"], ["wavelength", "波长"], ["phase", "起始相位"],
    ["speed", "波动速度"], ["taper", "两端收束"], ["startX", "起点横坐标"], ["startY", "起点纵坐标"],
    ["endX", "终点横坐标"], ["endY", "终点纵坐标"]],
  wave_surface: [["mode", "波面模式"], ["gridSize", "网格尺寸"], ["amplitude", "波面幅度"],
    ["frequencyX", "横向频率"], ["frequencyY", "纵向频率"], ["damping", "波动阻尼"],
    ["speed", "波动速度"], ["crestColor", "波峰颜色"], ["troughColor", "波谷颜色"]],
  wave_warp: [["amplitude", "扭曲幅度"], ["frequency", "波纹频率"], ["axis", "扭曲方向"],
    ["phase", "起始相位"], ["speed", "波动速度"], ["edgeMode", "边缘模式"]],
  waveform: [["sampleCount", "采样数量"], ["gain", "波形增益"], ["smoothing", "波形平滑度"],
    ["thickness", "线条粗细"], ["horizontalScale", "横向缩放"], ["mirror", "镜像显示"],
    ["lineColor", "波形颜色"], ["backgroundColor", "背景颜色"]],
  wipe: [["direction", "擦除方向"], ["softness", "边缘柔和度"], ["angle", "擦除角度"],
    ["progress", "擦除进度"], ["duration", "擦除时长"]],
  zoom_tunnel: [["transitionStart", "转场开始时间"], ["duration", "转场时长"], ["startScale", "起始缩放"],
    ["endScale", "结束缩放"], ["tunnelDepth", "隧道深度"], ["motionBlur", "运动模糊"],
    ["twistDegrees", "扭转角度"], ["easing", "缓动方式"]]
} satisfies Readonly<Record<string, readonly ImportantParameter[]>>);

export const SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES = Object.freeze(Object.keys(IMPORTANT_PARAMETERS));

function definitionFor(toolName: string) {
  const definition = EFFECT_TOOL_REGISTRY.getByToolName(toolName);
  if (definition === undefined) throw new TypeError(`${toolName} 不存在于特效 Registry。`);
  return definition;
}

export function importantParameterDefinitions(toolName: string): readonly ImportantParameter[] {
  const fields = IMPORTANT_PARAMETERS[toolName as keyof typeof IMPORTANT_PARAMETERS];
  if (fields === undefined || fields.length === 0) throw new TypeError(`${toolName} 未定义重要自检参数。`);
  const definition = definitionFor(toolName);
  const schema = definition.parameterSchema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)
    || typeof schema.properties !== "object" || schema.properties === null || Array.isArray(schema.properties)) {
    throw new TypeError(`${toolName} 的 Registry Schema 缺少参数 properties。`);
  }
  const properties = schema.properties;
  const seen = new Set<string>();
  for (const [name, label] of fields) {
    if (!Object.hasOwn(properties, name)) throw new TypeError(`${toolName}.${name} 不是 Registry Schema 中的真实参数。`);
    if (seen.has(name)) throw new TypeError(`${toolName}.${name} 在重要参数中重复。`);
    if (label.trim().length === 0) throw new TypeError(`${toolName}.${name} 缺少中文名称。`);
    seen.add(name);
  }
  return fields;
}

export function selfCheckParameterInformation(
  toolName: string,
  params: Readonly<Record<string, unknown>>
): SelfCheckParameterInformation {
  const definition = definitionFor(toolName);
  const effectiveParams = validateAndNormalizeEffectEnvelope(definition, toolName, {
    type: toolName,
    data: Object.freeze({ ...definition.defaults, ...params })
  }).data;
  const output: Record<string, SelfCheckParameterInformationItem> = {};
  for (const [name, label] of importantParameterDefinitions(toolName)) {
    if (!Object.hasOwn(effectiveParams, name)) throw new TypeError(`${toolName} 的最终生效参数缺少 ${name}。`);
    output[name] = Object.freeze({ label, value: effectiveParams[name] });
  }
  return Object.freeze(output);
}

export function observedEffectInformation(
  information: readonly Readonly<{ label: string; value: string }>[]
): Readonly<{ key_information: readonly Readonly<{ label: string; value: string }>[] }> {
  return Object.freeze({ key_information: Object.freeze([...information]) });
}
