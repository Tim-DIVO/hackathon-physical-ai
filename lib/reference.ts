import type { ClipId, ProtocolStep } from "./types";
export const clips: {
  id: ClipId;
  title: string;
  duration: number;
  videoUrl: string;
  viewpoint: string;
}[] = [
  {
    id: "DJI_09",
    title: "Recording 01",
    duration: 100.1,
    videoUrl: "/videos/DJI_09-browser.mp4",
    viewpoint: "Third-person · TC hood",
  },
  {
    id: "DJI_10",
    title: "Recording 02",
    duration: 95.361933,
    videoUrl: "/videos/DJI_10-browser.mp4",
    viewpoint: "Third-person · TC hood",
  },
];
export const protocolSteps: ProtocolStep[] = [
  {
    id: 1,
    title: "Add reagent 1",
    description: "Add reagent 1 into a sterile 1.5 mL EP tube.",
  },
  {
    id: 2,
    title: "Add reagent 2",
    description: "Add reagent 2 into the EP tube.",
  },
  {
    id: 3,
    title: "Add reagent 3",
    description: "Add reagent 3 into the EP tube.",
  },
  { id: 4, title: "Mix", description: "Mix well." },
  {
    id: 5,
    title: "Incubate",
    description:
      "Incubate at room temperature for 20 min. This step may occur outside the recording.",
  },
  {
    id: 6,
    title: "Deliver mixture",
    description:
      "Add the mixture dropwise into a 10 cm dish of 293T cells (~70–80% confluency).",
  },
  {
    id: 7,
    title: "Rock dish",
    description: "Gently rock the dish forward and backward to mix.",
  },
];
export const datasetAttribution = {
  name: "LabSuperVision (LSV)",
  publisher: "cong-lab",
  url: "https://huggingface.co/datasets/cong-lab/lsv",
  license: "CC BY-NC 4.0",
  licenseUrl: "https://creativecommons.org/licenses/by-nc/4.0/",
  referenceNote:
    "Dataset labels and timestamp annotations are reference material, never model predictions.",
};

/** Synthetic demo registry; identities are operator annotations, never inferred from video. */
export const sampleRegistry = [
  { id: "CELL-A", name: "Cell suspension A", kind: "cell suspension", synthetic: true },
  { id: "REAGENT-01", name: "Transfection reagent", kind: "reagent", synthetic: true },
  { id: "PLASMID-01", name: "Plasmid preparation", kind: "plasmid", synthetic: true },
  { id: "DISH-01", name: "Culture dish", kind: "culture vessel", synthetic: true },
];
