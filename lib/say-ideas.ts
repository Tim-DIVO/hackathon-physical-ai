/**
 * Things the operator could say right now, shown in the HUD as prompts (never clickable). They are
 * examples of phrasing for facts the camera can't read (reagent names, volumes, concentrations), not
 * claims about what is in the tubes.
 */
const ASK = ["“What do I add next?”", "“Why does that matter?”"];

const CRISPR_STEP: Record<number, string[]> = {
  1: ["“Reagent 1 is Opti-MEM, 250 µL”", "“Fresh tip”"],
  2: ["“Reagent 2 is the Cas9 plasmid, 2.5 µg”", "“DNA is at 1 µg/µL”"],
  3: ["“Reagent 3 is Lipofectamine, 7.5 µL”", "“Changed tips”"],
  4: ["“Mixed by pipetting 10 times”", "“Flicked, not vortexed”"],
  5: ["“Incubating 20 minutes at room temp”"],
  6: ["“Cells are about 75% confluent”", "“Added dropwise”"],
  7: ["“Rocked front to back”", "“Back in the incubator”"],
};

const BY_PROCEDURE: [RegExp, string[]][] = [
  [/dilution/i, ["“1 to 10 dilution, 100 µL into 900 µL”", "“Tube 3 is 1 mM”", "“Changed tips between dilutions”"]],
  [/lentivir|infection/i, ["“MOI is 5”", "“Polybrene at 8 µg/mL”", "“Virus is lot 12, 50 µL”"]],
  [/packag/i, ["“psPAX2 and pMD2.G, 3 to 1 ratio”", "“PEI at 1 mg/mL”"]],
  [/freez/i, ["“10% DMSO in FBS”", "“1 million cells per vial”", "“Into the Mr. Frosty”"]],
];

export function sayIdeas(procedure: string | undefined, step: number | null, crispr: boolean): string[] {
  const specific = crispr
    ? (CRISPR_STEP[step ?? 1] ?? [])
    : (BY_PROCEDURE.find(([re]) => re.test(procedure ?? ""))?.[1] ?? ["“This is 50 µL of PBS”", "“Concentration is 1 mg/mL”"]);
  return [...specific, ...ASK].slice(0, 4);
}
