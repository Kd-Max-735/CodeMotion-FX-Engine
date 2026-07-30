import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { GROUP_2_P0_EFFECTS } from "./dist/index.js";

const outputDirectory = resolve(import.meta.dirname, "previews");
await mkdir(outputDirectory, { recursive: true });

function numericIdentity(value) {
  let state = 0x811c9dc5;
  for (const character of value) {
    state ^= character.codePointAt(0);
    state = Math.imul(state, 0x01000193);
  }
  return state >>> 0;
}

function svg(effect, variant, index) {
  const identity = numericIdentity(`${effect.effectId}:${variant}`);
  const hue = identity % 360;
  const hue2 = (hue + 83 + index * 29) % 360;
  const radius = 15 + (identity % 24);
  const offset = 18 + ((identity >>> 8) % 92);
  const label = variant === "effect" ? effect.sourceId : `${effect.sourceId} ${variant}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="90" viewBox="0 0 160 90" role="img" aria-label="${effect.displayName} ${variant}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop stop-color="hsl(${hue} 82% 58%)" stop-opacity=".92"/>
      <stop offset="1" stop-color="hsl(${hue2} 88% 48%)" stop-opacity=".36"/>
    </linearGradient>
    <filter id="soft"><feGaussianBlur stdDeviation="${1 + index * 0.6}"/></filter>
  </defs>
  <rect width="160" height="90" rx="8" fill="#08101f"/>
  <path d="M8 66 C${offset} 8 ${160 - offset} 84 152 22" fill="none" stroke="url(#g)" stroke-width="${3 + index}" stroke-linecap="round"/>
  <circle cx="${offset}" cy="${28 + index * 8}" r="${radius}" fill="url(#g)" filter="url(#soft)" opacity=".62"/>
  <rect x="${82 - index * 5}" y="${16 + index * 4}" width="${58 + index * 4}" height="${44 - index * 5}" rx="7" fill="none" stroke="hsl(${hue2} 90% 72%)" stroke-opacity=".72"/>
  <text x="10" y="82" fill="#f3f7ff" font-family="system-ui,sans-serif" font-size="10" font-weight="700">${label}</text>
</svg>`;
}

for (const effect of GROUP_2_P0_EFFECTS) {
  await writeFile(
    resolve(outputDirectory, `${effect.sourceId}.svg`),
    svg(effect, "effect", 0),
    "utf8"
  );
  for (const [index, preset] of effect.presets.entries()) {
    const variant = preset.name.split(" ").at(-1).toLowerCase();
    await writeFile(
      resolve(outputDirectory, `${effect.sourceId}-${variant}.svg`),
      svg(effect, variant, index + 1),
      "utf8"
    );
  }
}

console.log(JSON.stringify({
  effects: GROUP_2_P0_EFFECTS.length,
  presets: GROUP_2_P0_EFFECTS.reduce((count, effect) => count + effect.presets.length, 0),
  assets: GROUP_2_P0_EFFECTS.length * 4,
  outputDirectory
}, null, 2));
