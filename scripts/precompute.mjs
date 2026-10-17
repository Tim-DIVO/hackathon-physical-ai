// Run with the Next development server already running. This calls the same real
// inference route used by the app and writes its validated cache on the server.
const base = process.env.LABLENS_URL || "http://localhost:3000";
for (const clipId of ["DJI_09", "DJI_10"]) {
  const response = await fetch(`${base}/api/analyze`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clipId, refresh: true }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${clipId}: ${result.error}`);
  console.log(
    `${clipId}: ${result.events.length} model events, ${result.model}`,
  );
}
