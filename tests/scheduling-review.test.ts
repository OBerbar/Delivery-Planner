import { it, expect } from "vitest";
import { schedulingReview } from "../src/lib/scheduling-review";
import { schedule } from "../src/lib/planning";
import { applyFeatureChange } from "../src/lib/changes";
import { maintenanceFixture, fixedToday } from "../scripts/maintenance-fixture";
it("previews actual capacity reassigned by parallel work even when other dates stay fixed", () => {
  const before = maintenanceFixture();
  const next = applyFeatureChange(before, {
    ...before.features[0],
    id: "parallel",
    title: "Parallel day",
    committed: false,
    commitment: undefined,
    doesntAffectOtherWork: true,
    sprintEstimate: undefined,
    assigneeEstimates: [{ personId: "p", unit: "days", value: 1 }],
    estimateEffort: [{ personId: "p", hours: 8 }],
  });
  const old = schedule(before, fixedToday),
    current = schedule(next, fixedToday);
  const result = schedulingReview(before, next, old, current);
  expect(result).toContainEqual(
    expect.objectContaining({
      id: "long",
      allocatedBefore: 400,
      allocatedAfter: 392,
      before: old.features.long.end,
      after: old.features.long.end,
    }),
  );
  expect(result.map((change) => change.id)).not.toContain("parallel");
  expect(before.features[0].estimateEffort).toEqual([
    { personId: "p", hours: 400 },
  ]);
});
