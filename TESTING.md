# Manual test checklist

Format: action -> expected result. Dev server on http://localhost:3000. Each live run costs about $0.40, so do as few as needed.

## A. Setup sanity
1. Open `.env.local` -> has OPENAI_API_KEY, OPENAI_MODEL=gpt-5.5, ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID.
2. `npm run typecheck` -> no errors.
3. Open `/` -> workspace loads, video plays, 7 tabs visible (Overview, Protocol, Sample lineage, Safety, Training, AI dataset, Export).
4. Open `/live` -> recording dropdown lists DJI_09, DJI_10 and 4 clips marked "unseen".

## B. Live session
5. Select DJI_09, click Analyse live -> status shows analysing; first note appears after the first window returns.
6. Watch playback -> notes appear only as the playhead reaches them, never ahead of it.
7. If analysis lags -> video pauses with a waiting status and resumes automatically when the next window lands.
8. Wait for completion -> status shows done; "Replay last run" appears.
9. Click Replay last run -> same notes replay in sync, with no new request to /api/analyze/window (network tab).
10. Switch to an unseen first-person clip -> clip loads, notes cleared; Analyse live works the same way.
11. Click a note or marker on the timeline -> video seeks there.

## C. Voice
12. Start the voice assistant -> connects to ElevenLabs (no browser-fallback label) and signals ready.
13. Say "That's sample CELL-A. I'm adding 100 microlitres." -> sample and 100 uL appear as operator-confirmed on the current note.
14. Say "Actually, I changed tips before that step." -> tip flag on the current note is dismissed and marked operator-confirmed.
15. Say "What step am I on?" / "What should I do next?" -> short spoken answer matching the protocol step.
16. Say "Did you detect any mistakes?" -> agent reads open flags from state.
17. Say "Show the lineage for sample CELL-A." -> lineage view opens focused on CELL-A.
18. Say "Show me the evidence." -> video seeks to the flagged observation.
19. Say "Generate my experiment report." -> a report file downloads.
20. On a clip that triggers tip reuse -> agent speaks the alert unprompted, in about one sentence.
21. Say "I changed tips" after that alert -> flag dismissed; simulated atlas cells move back.
22. Narrate "I'm now mixing the tube gently" -> appears as an operator note (labelled operator, not model) at the current playback time.
23. Turn coach mode on -> on a newly observed protocol step the agent gives brief guidance; turn it off -> guidance stops.
24. Blank ELEVENLABS_AGENT_ID and reload -> browser speech recognition and TTS fallback with a visible label.

## D. Supervisor rules
25. Play to a delivery that follows mixing closely -> incubation rule fires (20 min requirement; asks if it happened off camera).
26. An addition with unconfirmed samples -> prompt asking which sample it was.
27. Click Confirm on one flag and Dismiss on another -> first becomes confirmed, second leaves the open flags.

## E. Workspace
28. Overview timeline: click an event -> video seeks to it.
29. After a voice sample assignment, open Sample lineage -> graph shows the new source/destination link.
30. Safety tab -> "Model vs dataset reference" card (DJI_09 true positive, DJI_10 false positive) and "Generalisation check · 50 unseen LSV clips" card (accuracy 0.20, balanced 0.33, TP 0 / FP 5 / TN 10 / FN 35, 40 unclear, about $3.12, plain conclusion).
31. AI dataset tab -> cell atlas animates and is labelled simulated.
32. Export tab: download Markdown, JSON and CSV -> all three download; each separates operator-confirmed values from model observations.

## F. Honesty checks
33. Scan /live and the workspace -> no confidence percentages or scores anywhere.
34. Volumes -> shown only where the operator stated them; otherwise blank or unknown.
35. /live -> no dataset ground truth or reference error text visible.
36. Cell atlas and AnnData example -> clearly labelled simulated or hypothetical.
