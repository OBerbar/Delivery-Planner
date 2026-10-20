import { z } from "zod";
import { format, parseISO, isValid, differenceInCalendarDays } from "date-fns";
export const uid = () => crypto.randomUUID();
export const today = () => format(new Date(), "yyyy-MM-dd");
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1, "This field is required").max(250);
const date = z
  .string()
  .refine(
    (v) =>
      /^\d{4}-\d{2}-\d{2}$/.test(v) &&
      isValid(parseISO(v)) &&
      format(parseISO(v), "yyyy-MM-dd") === v,
    "Enter a valid date",
  );
const weekends = z
  .array(z.number().int().min(0).max(6))
  .max(6)
  .refine((v) => new Set(v).size === v.length, "Duplicate weekdays");
export const appSchema = z.object({
  id,
  name,
  color: z.string().regex(/^#[0-9a-f]{6}$/i),
  weekends,
  planningStart: date,
  cadence: z.enum(["2w", "3w", "month", "custom"]),
  customDays: z.number().int().min(1).max(366),
  terms: z.string().max(30000),
  archived: z.boolean().default(false),
});
export const personSchema = z.object({
  id,
  name,
  dailyHours: z.number().min(0.25).max(16),
});
export const memberSchema = z.object({
  id,
  appId: id,
  personId: id,
  role: name,
  allocation: z.number().min(1).max(100),
  weekends: weekends.nullable(),
});
export const taskSchema = z
  .object({
    id,
    title: name,
    personId: id,
    scope: name,
    hours: z.number().min(0.25).max(5000),
    status: z.enum(["todo", "doing", "blocked", "done"]),
    dependsOn: z.array(id).max(100),
    dependsOnFeatures: z.array(id).max(100).optional(),
    unblockDate: date.optional(),
    actualStart: date.optional(),
    actualEnd: date.optional(),
  })
  .refine(
    (t) =>
      t.status !== "done" ||
      (!!t.actualStart && !!t.actualEnd && t.actualEnd >= t.actualStart),
    "Completed tasks need valid actual dates",
  );
export const reservationId = (featureId: string, personId: string) =>
  `estimate:${JSON.stringify([featureId, personId])}`;
export const assigneeEstimateSchema = z.discriminatedUnion("unit", [
  z.object({
    personId: id,
    unit: z.literal("sprints"),
    value: z.number().min(0.5).max(100),
  }),
  z.object({
    personId: id,
    unit: z.literal("days"),
    value: z.number().min(0.25).max(1000),
  }),
]);
export type AssigneeEstimate = z.infer<typeof assigneeEstimateSchema>;
export const featureSchema = z
  .object({
    id,
    appId: id,
    title: name,
    description: z.string().max(10000).default(""),
    completion: z.string().max(10000).default(""),
    priority: z.number().int().min(0),
    tasks: z.array(taskSchema).max(100),
    sprintEstimate: z.number().min(0.5).max(100).optional(),
    assigneeEstimates: z.array(assigneeEstimateSchema).max(1000).optional(),
    assigneeIds: z.array(id).max(1000).optional(),
    estimateEffort: z
      .array(
        z.object({ personId: id, hours: z.number().positive().max(600000) }),
      )
      .max(1000)
      .optional(),
    status: z.enum(["todo", "doing", "blocked", "done"]).optional(),
    blocked: z.boolean().optional(),
    unblockDate: date.optional(),
    actualStart: date.optional(),
    actualEnd: date.optional(),
    target: date.optional(),
    notBefore: date.optional(),
    planningFrom: date.optional(),
    sprintId: id.optional(),
    doesntAffectOtherWork: z.boolean().optional(),
    ignoreLeave: z.boolean().optional(),
    committed: z.boolean().default(false),
    commitment: z.object({ end: date, acceptedAt: date }).optional(),
    link: z.string().max(2000).default(""),
  })
  .superRefine((f, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const assignees = f.assigneeIds ?? [];
    if (new Set(assignees).size !== assignees.length)
      fail("Main assignees must be unique");
    if (
      f.assigneeEstimates !== undefined &&
      (f.assigneeEstimates.length !== assignees.length ||
        new Set(f.assigneeEstimates.map((e) => e.personId)).size !==
          f.assigneeEstimates.length ||
        assignees.some(
          (p) => !f.assigneeEstimates!.some((e) => e.personId === p),
        ))
    )
      fail("Individual estimates must match the selected main assignees");
    if (!f.tasks.length) {
      if (!f.sprintEstimate && !f.assigneeEstimates?.length)
        fail("Enter an effort estimate or add a task breakdown");
      if (!assignees.length) fail("Select at least one main assignee");
      const effort = f.estimateEffort ?? [];
      if (
        effort.length !== assignees.length ||
        new Set(effort.map((e) => e.personId)).size !== effort.length ||
        assignees.some((p) => !effort.some((e) => e.personId === p))
      )
        fail("Sprint effort must match the selected main assignees");
      if (
        f.status === "done" &&
        (!f.actualStart || !f.actualEnd || f.actualEnd < f.actualStart)
      )
        fail("Completed features need valid actual dates");
    }
  });
export const sprintSchema = z
  .object({
    id,
    appId: id,
    number: z.number().int().min(1).max(99999),
    start: date,
    end: date,
    goal: z.string().max(10000),
    notes: z.string().max(10000),
    snapshot: z.string().max(100000).nullable(),
    draft: z.string().max(100000).nullable().optional(),
  })
  .refine((s) => s.end >= s.start, "Sprint end must follow its start");
export const leaveSchema = z
  .object({
    id,
    personId: id,
    start: date,
    end: date,
    hours: z.number().min(0.0025).max(16).nullable(),
    note: z.string().max(1000),
    templateId: id.optional(),
    templateEntryId: id.optional(),
  })
  .refine((l) => l.end >= l.start, "Leave end must follow its start");
export const holidaySchema = z.object({
  id,
  appId: id,
  date,
  name,
  personIds: z
    .array(id)
    .min(1)
    .max(1000)
    .refine(
      (v) => new Set(v).size === v.length,
      "Holiday people must be unique",
    )
    .optional(),
  templateId: id.optional(),
  templateEntryId: id.optional(),
});
export const calendarEntrySchema = z
  .object({
    id,
    name,
    kind: z.enum(["holiday", "leave"]),
    start: date,
    end: date,
    hours: z.number().min(0.0025).max(16).nullable(),
    dayFraction: z.number().min(0.01).max(1).optional(),
  })
  .refine((e) => e.end >= e.start, "Calendar end must follow its start")
  .refine(
    (e) => differenceInCalendarDays(parseISO(e.end), parseISO(e.start)) < 366,
    "Calendar entry may span at most 366 days",
  )
  .refine(
    (e) =>
      e.kind !== "holiday" || (e.hours === null && e.dayFraction === undefined),
    "Holidays must be full days",
  );
export const calendarTemplateSchema = z.object({
  id,
  name,
  entries: z
    .array(calendarEntrySchema)
    .min(1, "Add at least one calendar entry")
    .max(100),
});
export type CalendarEntry = z.infer<typeof calendarEntrySchema>;
export type CalendarTemplate = z.infer<typeof calendarTemplateSchema>;
export type Holiday = z.infer<typeof holidaySchema>;
export const stateSchema = z
  .object({
    version: z.literal(1),
    apps: z.array(appSchema).max(100),
    people: z.array(personSchema).max(1000),
    members: z.array(memberSchema).max(3000),
    features: z.array(featureSchema).max(5000),
    leaves: z.array(leaveSchema).max(5000),
    holidays: z.array(holidaySchema).max(5000),
    calendarTemplates: z.array(calendarTemplateSchema).max(100).optional(),
    sprints: z.array(sprintSchema).max(5000),
  })
  .superRefine((s, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: "custom", message });
    const apps = new Set(s.apps.map((a) => a.id)),
      people = new Set(s.people.map((p) => p.id));
    const ids = [
      ...s.apps,
      ...s.people,
      ...s.members,
      ...s.features,
      ...s.features.flatMap((f) => f.tasks),
      ...s.features
        .filter((f) => !f.tasks.length)
        .flatMap((f) =>
          (f.assigneeIds ?? []).map((p) => ({ id: reservationId(f.id, p) })),
        ),
      ...s.leaves,
      ...s.holidays,
      ...s.sprints,
      ...(s.calendarTemplates ?? []),
      ...(s.calendarTemplates ?? []).flatMap((t) => t.entries),
    ].map((x) => x.id);
    if (new Set(ids).size !== ids.length)
      fail("Every record must have a unique ID");
    const pairs = new Set<string>();
    for (const m of s.members) {
      if (!apps.has(m.appId) || !people.has(m.personId))
        fail("Team member references a missing app or person");
      const key = m.appId + "|" + m.personId;
      if (pairs.has(key)) fail("A person can only join an app once");
      pairs.add(key);
    }
    const tasks = new Map(
      s.features.flatMap((f) => [
        ...f.tasks.map((t) => [t.id, f.appId] as const),
        ...(!f.tasks.length
          ? (f.assigneeIds ?? []).map(
              (p) => [reservationId(f.id, p), f.appId] as const,
            )
          : []),
      ]),
    );
    for (const f of s.features) {
      if (!apps.has(f.appId)) fail("Feature app is missing");
      if ((f.assigneeIds ?? []).some((p) => !pairs.has(f.appId + "|" + p)))
        fail("Main assignees must belong to the app");
      if (
        f.sprintId &&
        !s.sprints.some((v) => v.id === f.sprintId && v.appId === f.appId)
      )
        fail("Feature sprint is missing or belongs to another app");
      for (const t of f.tasks) {
        if (
          t.dependsOnFeatures?.some((d) => !s.features.some((v) => v.id === d))
        )
          fail("Dependency feature is missing");
        if (!pairs.has(f.appId + "|" + t.personId))
          fail("Task owner must belong to the app");
        if (t.dependsOn.some((d) => !tasks.has(d)))
          fail("Dependency task is missing");
      }
    }
    for (const l of s.leaves)
      if (!people.has(l.personId)) fail("Leave person is missing");
    for (const h of s.holidays) {
      if (!apps.has(h.appId)) fail("Holiday app is missing");
      if (h.personIds?.some((p) => !pairs.has(h.appId + "|" + p)))
        fail("Holiday people must belong to the app");
    }
    const nums = new Set<string>();
    for (const sprint of s.sprints) {
      if (!apps.has(sprint.appId)) fail("Sprint app is missing");
      const key = sprint.appId + "|" + sprint.number;
      if (nums.has(key)) fail("Sprint numbers must be unique within an app");
      nums.add(key);
    }
  });
export type AppConfig = z.infer<typeof appSchema>;
export type Person = z.infer<typeof personSchema>;
export type Member = z.infer<typeof memberSchema>;
export type Feature = z.infer<typeof featureSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Sprint = z.infer<typeof sprintSchema>;
export type Leave = z.infer<typeof leaveSchema>;
export type PlannerState = z.infer<typeof stateSchema>;
export const emptyState: PlannerState = {
  version: 1,
  apps: [],
  people: [],
  members: [],
  features: [],
  leaves: [],
  holidays: [],
  sprints: [],
};
export const scopes = [
  "Design",
  "Web Frontend & Full stack",
  "Backend",
  "Mobile",
  "QA",
];
export const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const exampleRoster = [
  ["Alex Morgan", "Web Frontend & Full stack"],
  ["Sam Rivera", "Web Frontend & Full stack"],
  ["Jordan Lee", "Backend"],
  ["Taylor Quinn", "Mobile"],
  ["Casey Brooks", "QA"],
  ["Jamie Parker", "Design"],
];
export const defaultTerms = `**Planning changes**\n\nReview changes to scope, priorities, and availability before accepting new delivery dates.\n\nEstimates describe planned effort. Delivery forecasts depend on the team's working calendars, allocations, dependencies, and other bookings.\n\nConfirm any revised commitments with the people involved. Saved finalized plans remain unchanged until you explicitly create a new snapshot.`;

export function formError(error: unknown): string {
  if (error instanceof z.ZodError)
    return error.issues
      .map((i) => {
        const path = i.path
          .map((p, index) =>
            typeof p === "number"
              ? String(p + 1)
              : String(p).replace(/([A-Z])/g, " $1"),
          )
          .join(" ");
        return `${path ? path + ": " : ""}${i.message}`;
      })
      .join("\n");
  return error instanceof Error
    ? error.message
    : "Please check your entries and try again.";
}
