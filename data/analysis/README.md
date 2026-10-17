# Cached visual assessments

These JSON files are genuine **offline visual assessments by a GPT-6.1 Sol coding agent** of extracted frames. They are not OpenAI API response recordings and are not live discoveries. The reviewing agent had previously read dataset references, so these assessments must not be described as a blind evaluation.

The reviewer inspected `data/contact-sheets/DJI_09.jpg` and `DJI_10.jpg`, sampled at four-second intervals (centers 2, 6, 10, … seconds), and a denser `DJI_09-detail.jpg` covering approximately 12.5–59.5 seconds at one-second intervals. Each sheet is read left-to-right, then top-to-bottom. The supervising agent also inspected the dense sheet.

The review describes visible handling and pipette positioning. It does not claim to read reagent identities or liquid volumes. The possible tip-reuse flag is a request for human review: the pipette appears to retain a tip across repeated tube handling, but brief intervening actions and tube identities are uncertain. No completed protocol step is inferred merely from the reference sequence.

Each cache contains the source video SHA-256, model label, review method, timestamps and limitations. `frameTimes` records the sampled timestamps; event `evidenceFrames` points to supporting samples. The original dataset videos are used for hashing and inference; `-browser.mp4` files are playback derivatives.

To replace these assessments with reproducible server-side OpenAI inference, configure `OPENAI_API_KEY`, start the app, and run `npm run precompute`. This requests `refresh: true` and retains the offline cache if the request fails. The API route independently samples the original recordings every two seconds and excludes dataset error annotations from its prompt.

Source footage and derived sheets: cong-lab, [LabSuperVision](https://huggingface.co/datasets/cong-lab/lsv), [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). See the repository attribution notice.
