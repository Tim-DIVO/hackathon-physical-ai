import summary from "@/lib/eval-summary.json";

const s = summary;

export function UnseenEval() {
  const rows: [string, string][] = [
    ["Accuracy (unclear = no error flagged)", s.accuracy.toFixed(2)],
    ["Balanced accuracy", s.balanced_accuracy.toFixed(2)],
    [
      "Confusion (error = positive)",
      `TP ${s.confusion.tp} · FP ${s.confusion.fp} · TN ${s.confusion.tn} · FN ${s.confusion.fn}`,
    ],
    ["Unclear predictions", `${s.n_unclear} of ${s.n_clips}`],
    ["Error categories named correctly", `${s.category_named} of ${s.n_error}`],
    ["Forced-verdict subset (24 clips)", `balanced accuracy ${s.forced.balanced_accuracy.toFixed(2)}, TP ${s.forced.confusion.tp} · FP ${s.forced.confusion.fp} · TN ${s.forced.confusion.tn} · FN ${s.forced.confusion.fn}`],
    ["API cost (estimated)", `about $${s.cost_usd.toFixed(2)}`],
  ];
  return (
    <div className="panel" style={{ marginTop: 16, padding: 16 }}>
      <h3 className="subheading">Generalisation check · 50 unseen LSV clips</h3>
      <p style={{ fontSize: 13, opacity: 0.8 }}>
        Zero-shot run on {s.n_clips} short pipette clips ({s.n_correct} correct,{" "}
        {s.n_error} with a labelled error) the model was never tuned on.
      </p>
      <table style={{ width: "100%", fontSize: 13, marginTop: 8 }}>
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td style={{ padding: "3px 0", opacity: 0.75 }}>{k}</td>
              <td style={{ padding: "3px 0", textAlign: "right" }}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ fontSize: 13, marginTop: 10 }}>
        <strong>Reference clips (2):</strong> 1 true positive (tip reuse on
        DJI_09) and 1 false positive (tip reuse flagged on DJI_10, a correct clip).
      </p>
      <p style={{ fontSize: 13, marginTop: 8, fontWeight: 600 }}>
        Current prompt-only approach does not reliably detect contamination
        errors on short unseen clips; tip-reuse detection on full procedures is
        promising but unvalidated.
      </p>
    </div>
  );
}
