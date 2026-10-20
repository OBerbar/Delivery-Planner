import { usePlanningMode } from "../lib/planning-mode";
import { SampleLink } from "./SampleWorkspace";
import { isSampleWorkspace } from "../lib/sample-workspace";
import { formError } from "../lib/model";
import { useEffect, useState } from "react";
import { Archive, Download, Upload, Save } from "lucide-react";
import { Button, Field, Pick, Weekends, ErrorText } from "./ui";
import { type PlannerState, type AppConfig, appSchema } from "../lib/model";
import { download } from "../lib/usePlanner";
export function Settings({
  state,
  appId,
  onSave,
  onRestore,
  busy,
}: {
  state: PlannerState;
  appId: string;
  onSave: (s: PlannerState) => Promise<void>;
  onRestore: (file: File) => Promise<void>;
  busy: boolean;
}) {
  const experiment = usePlanningMode();
  const [draft, setDraft] = useState<AppConfig>(
      state.apps.find((a) => a.id === appId)!,
    ),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    setDraft(state.apps.find((a) => a.id === appId)!);
  }, [state.apps, appId]);
  const patch = (v: Partial<AppConfig>) => {
    setDraft((d) => ({ ...d, ...v }));
    setSaved(false);
  };
  return (
    <div className="settings-grid">
      <section className="panel form-stack">
        <div>
          <span className="eyebrow">APP DEFAULTS</span>
          <h3>A workspace that fits your rhythm.</h3>
        </div>
        <Field
          label="App name"
          value={draft.name}
          onChange={(name) => patch({ name })}
        />
        <Field
          label="Planning starts"
          type="date"
          value={draft.planningStart}
          onChange={(planningStart) => patch({ planningStart })}
        />
        <div>
          <label className="field-caption">Default weekend days</label>
          <Weekends
            value={draft.weekends}
            onChange={(weekends) => patch({ weekends })}
          />
          <p className="helper">
            Members with personal overrides keep their own weekends.
          </p>
        </div>
        <Pick
          label="Default sprint length"
          value={draft.cadence}
          onChange={(cadence) =>
            patch({ cadence: cadence as AppConfig["cadence"] })
          }
          options={[
            { id: "2w", label: "2 weeks" },
            { id: "3w", label: "3 weeks" },
            { id: "month", label: "1 calendar month" },
            { id: "custom", label: "Custom duration" },
          ]}
        />
        {draft.cadence === "custom" && (
          <Field
            label="Calendar days per sprint"
            type="number"
            value={draft.customDays}
            onChange={(v) => patch({ customDays: Number(v) })}
            min={1}
            max={366}
          />
        )}
        <Field
          label="General terms for exported plans"
          value={draft.terms}
          onChange={(terms) => patch({ terms })}
          rows={8}
        />
        <ErrorText text={error} />
        <div className="button-row">
          <Button
            isPending={busy}
            onPress={async () => {
              try {
                const config = appSchema.parse(draft);
                await onSave({
                  ...state,
                  apps: state.apps.map((a) => (a.id === appId ? config : a)),
                });
                setSaved(true);
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            <Save size={16} />
            Save settings
          </Button>
          {saved && (
            <span className="saved-note" role="status">
              {experiment
                ? "Updated in experiment. Apply to save."
                : "Saved. Forecast updated."}
            </span>
          )}
        </div>
      </section>
      <div className="form-stack">
        <section className="panel">
          <span className="eyebrow">YOUR DATA, YOUR COMPUTER</span>
          <h3>Make a little room for peace of mind.</h3>
          <p>
            {isSampleWorkspace()
              ? "This sample stays only in this tab's memory. Backup and restore here affect the sample only. Refreshing or leaving discards it."
              : "Everything is saved locally. A backup includes all apps, people, features, leave, sprints, and finalized plans."}
          </p>
          <div className="form-stack">
            {!isSampleWorkspace() && <SampleLink />}
            <Button
              variant="outline"
              isDisabled={experiment || busy}
              onPress={() =>
                download(
                  `delivery-studio-backup-${new Date().toISOString().slice(0, 10)}.json`,
                  JSON.stringify(state, null, 2),
                  "application/json",
                )
              }
            >
              <Download size={16} />
              Export full backup
            </Button>
            <label className="upload-button">
              <Upload size={16} />
              Restore backup
              <input
                aria-label="Restore backup"
                disabled={experiment || busy}
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    try {
                      if (
                        confirm(
                          "Replace the current workspace with this backup? You can undo the restore.",
                        )
                      )
                        await onRestore(file);
                    } catch (err) {
                      setError(formError(err));
                    }
                    e.target.value = "";
                  }
                }}
              />
            </label>
          </div>
        </section>
        <section className="panel">
          <span className="eyebrow">WORKSPACE MANAGEMENT</span>
          <h3>
            {draft.archived ? "Bring this app back." : "Finished for now?"}
          </h3>
          <p>
            {draft.archived
              ? "Restore this app to the active workspace."
              : "Archive this app to pause its unfinished work and release its resources. Your saved plans remain available."}
          </p>
          <Button
            variant="outline"
            onPress={async () => {
              try {
                await onSave({
                  ...state,
                  apps: state.apps.map((a) =>
                    a.id === appId ? { ...a, archived: !a.archived } : a,
                  ),
                });
                setDraft((d) => ({ ...d, archived: !d.archived }));
              } catch (e) {
                setError(formError(e));
              }
            }}
          >
            <Archive size={16} />
            {draft.archived ? "Restore app" : "Archive app"}
          </Button>
        </section>
        <section className="panel info-panel">
          <p>
            Existing sprint dates stay fixed when you change the default
            cadence. Use Edit sprint to override a particular sprint.
          </p>
        </section>
      </div>
    </div>
  );
}
