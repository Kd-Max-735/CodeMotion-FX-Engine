# AE Agent

AE Agent 是一个根据自然语言参数生成视频特效的本地应用。项目注册了 120 个独立特效工具；用户每次手动选择一个工具，服务端调用火山方舟模型生成该工具的结构化参数，再由服务端完成素材绑定、逐帧渲染、预览和 MP4 导出。

当前唯一模型 Provider 是火山方舟 `doubao-seed-2-0-lite-260428`。需要主体分割的特效通过局域网中的 SAM3 服务获取服务器授权的分割结果。

## 环境要求

- Node.js 22 或更高版本
- npm 10 或更高版本
- FFmpeg 和 FFprobe 可从系统 `PATH` 访问
- 使用 AI 参数生成时，需要有效的火山方舟 API Key
- 使用主体分割特效时，需要能够访问 SAM3 网关
- NVIDIA 显卡为可选项；环境支持 NVENC 时，导出器会自动使用硬件编码

## 安装与配置

在项目根目录安装锁定版本的依赖：

```powershell
npm ci
```

根据模板创建本机环境配置：

```powershell
Copy-Item .env.example .env
```

编辑 `.env`：

```dotenv
ARK_API_KEY=your_server_side_ark_api_key
SAM3_API_BASE_URL=http://192.168.1.31:9100
SAM3_THRESHOLD=0.3
SAM3_TIMEOUT_MS=600000
SAM3_READINESS_TIMEOUT_MS=10000
SAM3_POLL_INTERVAL_MS=250
```

`.env` 只用于本机服务器配置，已被 Git 忽略。不要提交、压缩或发送包含真实密钥的 `.env` 文件。SAM3 地址需要按实际局域网环境修改。

## 启动项目

```powershell
npm run dev
```

浏览器访问：

```text
http://127.0.0.1:4174
```

开发服务器固定使用 `127.0.0.1:4174`，端口被占用时会直接停止，不会自动切换端口。

## 使用流程

1. 在前端手动选择一个特效工具。
2. 按该工具要求上传图片、视频、音频或其他素材。
3. 输入自然语言描述，包括视觉效果、时长和生成模式等要求。
4. 服务端只向模型提供所选工具的 Markdown 规范和闭合参数 Schema。
5. 模型返回所选工具的原生 Tool Call；素材 ID、文件路径和服务器资源不会进入模型参数。
6. 服务端校验参数并绑定当前用户授权的素材。
7. 服务端逐帧渲染视频，生成预览并导出 MP4。

生成模式由服务端映射到固定帧率：

| 模式 | Tool Call 值 | 帧率 |
| --- | --- | ---: |
| 快速 | `fast` | 15 FPS |
| 标准 | `standard` | 30 FPS |
| 精美 | `fine` | 60 FPS |

未指定视频时长时默认生成 5 秒。明确提出“长一点”或“短一点”时，以明确时长或默认时长为基准调整 2 秒；最终时长限制为 1 至 60 秒。

## 120 个工具规范

所有工具 Markdown 文档集中在：

```text
packages/effect-functions/field-specs/tools/<tool_name>.md
```

目录中应当恰好存在 120 个 Markdown 文件。每份文档只描述对应工具允许由模型生成的参数；图片、视频、音频、遮罩、深度图、字体、纹理、文件 ID、路径和 URL 均由服务器单独授权和绑定。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 启动 AE Agent 开发服务器 |
| `npm run build` | 构建全部工作区包 |
| `npm run typecheck` | 检查源码和测试代码类型 |
| `npm test` | 构建并运行完整测试集 |
| `npm run preview` | 预览前端生产构建 |

## 主要目录

| 目录 | 作用 |
| --- | --- |
| `packages/editor` | AE Agent 前端、开发服务器和当前请求链路 |
| `packages/ai-planner` | 火山方舟调用及选中工具参数生成 |
| `packages/effect-functions` | 120 个工具的公共契约、注册表、实现适配和 Markdown 规范 |
| `packages/exporter` | 媒体读取、逐帧输出和 MP4 导出 |
| `packages/renderer-webgl` | WebGL 渲染能力 |
| `packages/effects-2d` | 二维特效实现 |
| `packages/effects-3d` | 三维特效实现 |
| `docs` | 当前架构、安全边界和历史阶段证据 |
| `examples` | 最小工程、播放、核心能力和 WebGL 示例 |
| `tmp` | 上传素材、预览和导出等本地运行产物，不应提交 |

## 当前架构约束

- 一次请求只能执行用户明确选择的一个工具。
- 不进行模型选工具、多工具组合、ReAct 或前端编辑台处理。
- 模型参数和服务器授权素材是两套独立契约。
- 预览、渲染、导出、身份校验、租户隔离和资源访问均在服务端完成。
- 当前架构说明见 [`docs/api/current-server-single-tool-architecture.md`](docs/api/current-server-single-tool-architecture.md)。
