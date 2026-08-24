import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES,
  importantParameterDefinitions
} from "../dist/self-check-parameter-summary.js";

const ruleDirectory = resolve(import.meta.dirname, "../../effect-functions/self-check-rules/tools");
const blockPattern = /\n?<!-- self-check-parameter-contract:start -->[\s\S]*?<!-- self-check-parameter-contract:end -->\n?/gu;
const obsoleteParameterOutput = /(?:不|不得)(?:读取或)?输出(?:函数)?参数|不得用内部参数值|不核对或输出函数参数/u;
const contradictoryParameterBan = /(?:不输出|不读取)[^。\r\n]*(?:参数|幅度|频率|速度|相位|方式)/u;

function parameterContract(toolName) {
  const rows = importantParameterDefinitions(toolName)
    .map(([name, label]) => `| \`${name}\` | ${label} |`)
    .join("\n");
  return [
    "<!-- self-check-parameter-contract:start -->",
    "## 重要参数契约",
    "",
    "- `summary.key_information` 必须是对象；每个 key 都必须逐字等于本工具 Registry Schema 中真实存在的参数名。",
    "- 这里只显示对最终视频变化有直接判断价值的重要参数：",
    "",
    "| JSON key | 中文名称 |",
    "| --- | --- |",
    rows,
    "",
    "- 每项结构固定为 `{ \"label\": \"中文名称\", \"value\": 最终生效值 }`。`value` 来自补齐默认值、验证并标准化后真正用于渲染的参数，禁止猜测、改名或新增参数。",
    "- `metadata.effect` 与 `metadata.observed_effect` 记录从最终 MP4 和关键帧得到的成片观察证据；它们不是参数，不得混入 `summary.key_information`。",
    "<!-- self-check-parameter-contract:end -->"
  ].join("\n");
}

for (const toolName of SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES) {
  const path = resolve(ruleDirectory, `${toolName}.md`);
  const original = await readFile(path, "utf8");
  const withoutOldBlock = original.replace(blockPattern, "\n");
  const lines = withoutOldBlock.split(/\r?\n/gu).filter((line) => {
    if (obsoleteParameterOutput.test(line)) return false;
    return true;
  }).map((line) => {
    if (contradictoryParameterBan.test(line)) {
      return "- 不把算法、公式、后端、资源身份、路径或中间数据混入参数摘要。";
    }
    return line;
  });
  if (!lines[0]?.startsWith("# ")) throw new Error(`${toolName} 自检规则缺少一级标题。`);
  const body = lines.slice(1).join("\n").replace(/^\s+/u, "").replace(/\s+$/u, "");
  const updated = `${lines[0]}\n\n${parameterContract(toolName)}\n\n${body}\n`;
  await writeFile(path, updated, "utf8");
}

console.log(`已同步 ${SELF_CHECK_IMPORTANT_PARAMETER_TOOL_NAMES.length} 份自检重要参数契约。`);
