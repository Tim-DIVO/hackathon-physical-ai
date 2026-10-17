import { mkdir, stat, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
await mkdir("public/videos", { recursive: true });
for (const id of ["DJI_09", "DJI_10"]) {
  const target = path.resolve("public/videos", `${id}.mp4`);
  // Published 640px video lengths; a truncated old download is never accepted.
  const expected = id === "DJI_09" ? 56214993 : 52367627;
  try {
    if ((await stat(target)).size === expected) {
      console.log(`${id} already downloaded`);
      continue;
    }
  } catch {}
  const partial = `${target}.part`;
  const response = await fetch(
    `https://huggingface.co/datasets/cong-lab/lsv/resolve/main/videos640/${id}.mp4`,
  );
  if (!response.ok || !response.body)
    throw new Error(`Download ${id}: ${response.status}`);
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
    if ((await stat(partial)).size !== expected)
      throw new Error(`Incomplete download: ${id}`);
    await rename(partial, target);
    console.log(`Downloaded ${id}`);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
}

// Browser playback uses an H.264 derivative; inference retains the downloaded original.
const { execFile } = await import("node:child_process");
const { promisify } = await import("node:util");
const { default: ffmpeg } = await import("ffmpeg-static");
for (const id of ["DJI_09", "DJI_10"]) {
  const input = path.resolve("public/videos", `${id}.mp4`);
  const output = path.resolve("public/videos", `${id}-browser.mp4`);
  try {
    if ((await stat(output)).size > 1000) continue;
  } catch {}
  const pending = path.resolve("public/videos", `${id}-browser.part.mp4`);
  await promisify(execFile)(
    process.env.FFMPEG_PATH || ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      input,
      "-c:v",
      "libx264",
      "-preset",
      "fast",
      "-crf",
      "23",
      "-pix_fmt",
      "yuv420p",
      "-an",
      "-movflags",
      "+faststart",
      "-y",
      pending,
    ],
    { timeout: 300000 },
  );
  await rename(pending, output);
  console.log(`Prepared browser H.264 derivative ${id}`);
}

// Unseen LSV PMD clips offered in the app's library (data/library.json). Originals are kept in
// data/eval/clips (used for inference); browser H.264 derivatives go to public/videos/lsv.
const LSV_CLIPS = [
  ["correct", "pmd_correct_02"],
  ["correct", "pmd_correct_06"],
  ["incorrect", "pmd_incorrect_reuse_200ul_tip_12"],
  ["incorrect", "pmd_incorrect_reuse_same_media_10ul_tip_08"],
];
await mkdir("data/eval/clips", { recursive: true });
await mkdir("public/videos/lsv", { recursive: true });
for (const [folder, id] of LSV_CLIPS) {
  const original = path.resolve("data/eval/clips", `${id}.mp4`);
  try {
    if ((await stat(original)).size > 1000) {
      // already present
    }
  } catch {
    const response = await fetch(
      `https://huggingface.co/datasets/cong-lab/lsv/resolve/main/pmd/${folder}/${id}.mp4`,
    );
    if (!response.ok || !response.body) throw new Error(`Download ${id}: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(`${original}.part`));
    await rename(`${original}.part`, original);
    console.log(`Downloaded ${id}`);
  }
  const output = path.resolve("public/videos/lsv", `${id}.mp4`);
  try {
    if ((await stat(output)).size > 1000) continue;
  } catch {}
  const pending = path.resolve("public/videos/lsv", `${id}.part.mp4`);
  await promisify(execFile)(
    process.env.FFMPEG_PATH || ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-i", original, "-vf", "scale=960:-2", "-c:v", "libx264",
      "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", "-y", pending],
    { timeout: 300000 },
  );
  await rename(pending, output);
  console.log(`Prepared browser H.264 derivative ${id}`);
}

// Longer first-person smart-glasses (XM) LSV recordings (CC BY-NC 4.0, cong-lab/lsv). The 640px
// originals stay in data/eval/long (inference); browser H.264 derivatives go to public/videos/lsv.
const LONG_CLIPS = ["XM_34", "XM_33", "XM_24", "XM_30", "XM_41"];
await mkdir("data/eval/long", { recursive: true });
for (const id of LONG_CLIPS) {
  const original = path.resolve("data/eval/long", `${id}.mp4`);
  try {
    if ((await stat(original)).size <= 1000) throw new Error("empty");
  } catch {
    const response = await fetch(
      `https://huggingface.co/datasets/cong-lab/lsv/resolve/main/videos640/${id}.mp4`,
    );
    if (!response.ok || !response.body) throw new Error(`Download ${id}: ${response.status}`);
    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(`${original}.part`));
      await rename(`${original}.part`, original);
    } catch (error) {
      await rm(`${original}.part`, { force: true });
      throw error;
    }
    console.log(`Downloaded ${id}`);
  }
  const output = path.resolve("public/videos/lsv", `${id}.mp4`);
  try {
    if ((await stat(output)).size > 1000) continue;
  } catch {}
  const pending = path.resolve("public/videos/lsv", `${id}.part.mp4`);
  await promisify(execFile)(
    process.env.FFMPEG_PATH || ffmpeg,
    ["-hide_banner", "-loglevel", "error", "-i", original, "-vf", "scale='min(1280,iw)':-2", "-c:v", "libx264",
      "-preset", "medium", "-crf", "26", "-pix_fmt", "yuv420p", "-an", "-movflags", "+faststart", "-y", pending],
    { timeout: 600000 },
  );
  await rename(pending, output);
  console.log(`Prepared browser H.264 derivative ${id}`);
}
