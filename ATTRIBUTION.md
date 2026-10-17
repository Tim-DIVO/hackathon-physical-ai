# Dataset attribution

LabLens uses **LabSuperVision (LSV)**, published by **cong-lab**:
https://huggingface.co/datasets/cong-lab/lsv

Dataset recordings and reference annotations are licensed **Creative Commons Attribution–NonCommercial 4.0 International (CC BY-NC 4.0)**:
https://creativecommons.org/licenses/by-nc/4.0/

This prototype uses DJI_09 and DJI_10 from `videos640/`. These are third-person laboratory recordings, presented as a demonstration input for a future smart-glasses copilot. Local video files are downloaded from the original dataset and are not committed to this repository. Reference protocol text is adapted for display; raw source rows are retained in `data/reference.json`. Extracted frames and any demonstration recording containing the source footage remain subject to the dataset's noncommercial license and attribution requirements.

Dataset error annotations are reference labels for evaluation. They are never substituted for model predictions. Sample registry entries and any illustrative sequencing joins are synthetic and do not identify real samples in the recordings.
