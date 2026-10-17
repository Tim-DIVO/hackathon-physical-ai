import { readFile } from "node:fs/promises";
import path from "node:path";
import { clips } from "./reference";

export interface LibraryClip {
  id: string;
  title: string;
  duration: number;
  videoUrl: string;
  viewpoint: string;
  protocol?: string;
  /** Dataset label, kept server-side so it can't leak into prompts or the live UI. */
  referenceLabel?: string;
  sourcePath: string;
  unseen: boolean;
}

/** Reference clips plus unseen LSV clips listed in data/library.json. */
export async function listClips(): Promise<LibraryClip[]> {
  const base: LibraryClip[] = clips.map((c) => ({
    ...c,
    protocol: "CRISPR Cas9 delivery into 293T cells",
    sourcePath: `public/videos/${c.id}.mp4`,
    unseen: false,
  }));
  try {
    const extra = JSON.parse(
      await readFile(path.join(process.cwd(), "data", "library.json"), "utf8"),
    ) as Omit<LibraryClip, "unseen">[];
    return [...base, ...extra.map((c) => ({ ...c, unseen: true }))];
  } catch {
    return base;
  }
}

/** Resolves a clip id to its source file; ids are looked up, never used as paths. */
export async function resolveClip(id: string) {
  const clip = (await listClips()).find((c) => c.id === id);
  if (!clip) return null;
  const root = process.cwd();
  const file = path.resolve(root, clip.sourcePath);
  if (!file.startsWith(root + path.sep)) return null;
  return { clip, file };
}
