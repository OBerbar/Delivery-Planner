import { useState } from "react";
import type { AssigneeEstimate, Feature, PlannerState } from "../lib/model";
import { Button, Check, Field, Pick } from "./ui";
import { WORKING_DAYS_PER_SPRINT } from "../lib/feature-work";

type Estimate = Pick<AssigneeEstimate, "unit" | "value">;
type Method = "same" | "person";
const units = [
  { id: "sprints", label: "Sprints" },
  { id: "days", label: "Working days" },
];
const convert = (estimate: Estimate, unit: Estimate["unit"]): Estimate => ({
  unit,
  value:
    estimate.unit === unit
      ? estimate.value
      : Number(
          (
            estimate.value *
            (unit === "days"
              ? WORKING_DAYS_PER_SPRINT
              : 1 / WORKING_DAYS_PER_SPRINT)
          ).toFixed(8),
        ),
});

export function FeatureEstimates({
  state,
  draft,
  onChange,
}: {
  state: PlannerState;
  draft: Feature;
  onChange: (patch: Partial<Feature>) => void;
}) {
  const members = state.members.filter(
    (member) => member.appId === draft.appId,
  );
  const selected = draft.assigneeIds ?? [];
  const saved = draft.assigneeEstimates ?? [];
  const initial = saved[0] ?? {
    unit:
      draft.sprintEstimate === undefined
        ? ("days" as const)
        : ("sprints" as const),
    value: draft.sprintEstimate ?? 1,
  };
  const [method, setMethod] = useState<Method>(() =>
    saved.some(
      (estimate) =>
        estimate.unit !== initial.unit || estimate.value !== initial.value,
    )
      ? "person"
      : "same",
  );
  const [shared, setShared] = useState<Estimate>(() => ({
    unit: initial.unit,
    value: initial.value,
  }));
  const [individual, setIndividual] = useState<Record<string, Estimate>>(() =>
    Object.fromEntries(
      members.map((member) => [
        member.personId,
        saved.find((estimate) => estimate.personId === member.personId) ?? {
          unit: initial.unit,
          value: initial.value,
        },
      ]),
    ),
  );
  const publish = (
    ids: string[],
    nextMethod: Method,
    nextShared: Estimate,
    nextIndividual: Record<string, Estimate>,
  ) => {
    onChange({
      assigneeIds: ids,
      sprintEstimate:
        nextMethod === "same" && nextShared.unit === "sprints"
          ? Number.isFinite(nextShared.value)
            ? nextShared.value
            : undefined
          : undefined,
      assigneeEstimates:
        nextMethod === "same" && nextShared.unit === "sprints"
          ? undefined
          : ids.map((personId) => {
              const estimate =
                nextMethod === "same"
                  ? nextShared
                  : (nextIndividual[personId] ?? nextShared);
              return { personId, unit: estimate.unit, value: estimate.value };
            }),
    });
  };
  const changeShared = (estimate: Estimate) => {
    const next = Object.fromEntries(
      members.map((member) => [member.personId, estimate]),
    );
    setShared(estimate);
    setIndividual(next);
    publish(selected, method, estimate, next);
  };
  const changeIndividual = (personId: string, estimate: Estimate) => {
    const next = { ...individual, [personId]: estimate };
    setIndividual(next);
    publish(selected, method, shared, next);
  };
  const changeMethod = (value: string) => {
    const nextMethod = value as Method;
    const nextShared =
      nextMethod === "same" ? (individual[selected[0]] ?? shared) : shared;
    setMethod(nextMethod);
    setShared(nextShared);
    publish(selected, nextMethod, nextShared, individual);
  };
  return (
    <section className="estimate-panel">
      <div className="estimate-controls">
        <Pick
          label="Estimate method"
          value={method}
          onChange={changeMethod}
          options={[
            { id: "same", label: "Same for everyone" },
            { id: "person", label: "Per person" },
          ]}
        />
        {method === "same" && (
          <Pick
            label="Estimate unit"
            value={shared.unit}
            options={units}
            onChange={(unit) =>
              changeShared(convert(shared, unit as Estimate["unit"]))
            }
          />
        )}
      </div>
      {method === "same" && (
        <Field
          label={
            shared.unit === "sprints"
              ? "Sprint estimation"
              : "Working days estimation"
          }
          type="number"
          value={Number.isFinite(shared.value) ? shared.value : ""}
          onChange={(value) =>
            changeShared({
              ...shared,
              value: value === "" ? NaN : Number(value),
            })
          }
          min={shared.unit === "sprints" ? 0.5 : 0.25}
          max={shared.unit === "sprints" ? 100 : 1000}
          step={shared.unit === "sprints" ? 0.5 : 0.25}
          required={!draft.tasks.length}
          hint={
            draft.tasks.length
              ? "Optional planning context. Task effort drives this forecast."
              : "Remaining work for each main assignee. This amount applies to everyone selected below."
          }
        />
      )}
      <p className="helper estimate-conversion">
        {(shared.unit === "sprints" ||
          (method === "person" &&
            selected.some((id) => individual[id]?.unit === "sprints"))) && (
          <>1 sprint = {WORKING_DAYS_PER_SPRINT} working days. </>
        )}
        Leave and holidays move delivery dates without reducing the work.
      </p>
      <div className="section-heading">
        <h3>Main assignees</h3>
        <Button
          variant="ghost"
          size="sm"
          onPress={() =>
            publish(
              members.map((member) => member.personId),
              method,
              shared,
              individual,
            )
          }
        >
          Select all team
        </Button>
      </div>
      <div className="assignee-choices">
        {members.map((member) => {
          const person = state.people.find(
            (person) => person.id === member.personId,
          )!;
          return (
            <div key={member.personId}>
              <Check
                label={person.name}
                ariaLabel={`Main assignee: ${person.name}`}
                checked={selected.includes(member.personId)}
                onChange={(checked) =>
                  publish(
                    checked
                      ? [...selected, member.personId]
                      : selected.filter((id) => id !== member.personId),
                    method,
                    shared,
                    individual,
                  )
                }
              />
              <small>{member.role}</small>
            </div>
          );
        })}
      </div>
      {!members.length && (
        <p className="helper">
          Add team members in Team & leave to assign this feature.
        </p>
      )}
      {method === "person" && (
        <div className="person-estimates">
          {selected.map((personId) => {
            const person = state.people.find(
              (person) => person.id === personId,
            )!;
            const estimate = individual[personId] ?? shared;
            return (
              <div className="person-estimate-row" key={personId}>
                <Field
                  label={`${person.name} estimate`}
                  type="number"
                  value={Number.isFinite(estimate.value) ? estimate.value : ""}
                  onChange={(value) =>
                    changeIndividual(personId, {
                      ...estimate,
                      value: value === "" ? NaN : Number(value),
                    })
                  }
                  min={estimate.unit === "sprints" ? 0.5 : 0.25}
                  max={estimate.unit === "sprints" ? 100 : 1000}
                  step={estimate.unit === "sprints" ? 0.5 : 0.25}
                  required={!draft.tasks.length}
                />
                <Pick
                  label={`${person.name} estimate unit`}
                  value={estimate.unit}
                  options={units}
                  onChange={(unit) =>
                    changeIndividual(
                      personId,
                      convert(estimate, unit as Estimate["unit"]),
                    )
                  }
                />
              </div>
            );
          })}
          {!selected.length && (
            <p className="helper">
              Select a main assignee to enter their estimate.
            </p>
          )}
        </div>
      )}
      <p className="helper">
        {draft.tasks.length
          ? "The task owners below determine resource bookings. Your estimates stay here for later."
          : "All selected people are reserved for their estimate. New features take priority and can move existing delivery dates."}
      </p>
    </section>
  );
}
