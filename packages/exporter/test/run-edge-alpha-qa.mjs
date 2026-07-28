import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { chromium } from "playwright-core";

const videoPath = resolve(import.meta.dirname, "../../../tmp/stage-6-test/output/webm-60-64x36.webm");
const html = `<!doctype html><meta charset="utf-8"><video muted playsinline></video><script>
const video = document.querySelector("video");
video.src = "/alpha.webm";
window.result = new Promise((resolve, reject) => {
  video.addEventListener("error", () => reject(new Error("video decode failed")), { once: true });
  video.addEventListener("loadeddata", () => {
    const sample = (background) => {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.fillStyle = background;
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(video, 0, 0);
      const read = (x) => [...context.getImageData(x, Math.floor(canvas.height / 2), 1, 1).data];
      return { transparent: read(1), semi: read(Math.floor(canvas.width / 2)), opaque: read(canvas.width - 2) };
    };
    resolve({ width: video.videoWidth, height: video.videoHeight, green: sample("#00ff00"), blue: sample("#0000ff") });
  }, { once: true });
});
</script>`;

const server = createServer((request, response) => {
  if (request.url === "/alpha.webm") {
    response.setHeader("content-type", "video/webm");
    createReadStream(videoPath).pipe(response);
    return;
  }
  response.setHeader("content-type", "text/html; charset=utf-8");
  response.end(html);
});
await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
const address = server.address();
if (typeof address === "string" || address === null) throw new Error("HTTP server did not bind.");

let browser;
try {
  browser = await chromium.launch({
    executablePath: "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    headless: true
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/`, { waitUntil: "load" });
  const result = await page.evaluate(() => window.result);
  const distance = (left, right) => Math.max(...left.slice(0, 3).map((value, index) => Math.abs(value - right[index])));
  if (result.width !== 64 || result.height !== 36) throw new Error(`Unexpected video size ${result.width}x${result.height}.`);
  if (distance(result.green.transparent, [0, 255, 0, 255]) > 8) throw new Error(`Transparent region hid green: ${result.green.transparent}`);
  if (distance(result.blue.transparent, [0, 0, 255, 255]) > 8) throw new Error(`Transparent region hid blue: ${result.blue.transparent}`);
  if (distance(result.green.semi, result.blue.semi) < 40) throw new Error("Semi-transparent region did not blend with backgrounds.");
  if (distance(result.green.opaque, result.blue.opaque) > 8) throw new Error("Opaque region changed with its background.");
  console.log(JSON.stringify({
    browser: await page.evaluate(() => navigator.userAgent),
    video: { width: result.width, height: result.height },
    samples: result
  }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolveClose) => server.close(resolveClose));
}
