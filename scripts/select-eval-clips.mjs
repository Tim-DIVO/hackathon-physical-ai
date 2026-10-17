// Deterministic selection of ~50 unseen LSV PMD clips (all correct + stratified errors) and download.
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const BASE = "https://huggingface.co/datasets/cong-lab/lsv/resolve/main/";
const manifest = JSON.parse(fs.readFileSync("data/eval/pmd-manifest.json", "utf8"));
const QUOTA = { reuse_tip: 5, reuse_same_media: 3, surface_contamination: 9, early_release: 9, wrong_tip_for_pipette: 9 };

function spread(list, n) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor(((i + 0.5) * list.length) / n)]);
}
const byId = (a, b) => a.video_id.localeCompare(b.video_id);
const selected = [
  ...manifest.filter((r) => r.label === "correct").sort(byId),
  ...Object.entries(QUOTA).flatMap(([type, n]) =>
    spread(manifest.filter((r) => r.mistake_type === type).sort(byId), n)),
];
fs.mkdirSync("data/eval/clips", { recursive: true });
fs.writeFileSync("data/eval/selection.json", JSON.stringify(selected, null, 1));
console.log(selected.length, "clips,", (selected.reduce((s, r) => s + r.size_bytes, 0) / 1e6).toFixed(0), "MB");

let next = 0;
async function worker() {
  while (next < selected.length) {
    const r = selected[next++];
    const target = path.join("data/eval/clips", `${r.video_id}.mp4`);
    if (fs.existsSync(target) && fs.statSync(target).size === r.size_bytes) continue;
    const res = await fetch(BASE + r.video_path);
    if (!res.ok || !res.body) throw new Error(`${r.video_id}: ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(target + ".part"));
    fs.renameSync(target + ".part", target);
    console.log("got", r.video_id);
  }
}
await Promise.all([worker(), worker(), worker(), worker()]);
