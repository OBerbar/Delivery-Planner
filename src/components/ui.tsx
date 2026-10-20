import {
  Button,
  TextField,
  Input,
  TextArea,
  Label,
  Description,
  Modal,
  Select,
  ListBox,
} from "@heroui/react";
import type { ReactNode } from "react";
import { weekdays } from "../lib/model";
export { Button };
export function Field({
  label,
  value,
  onChange,
  type = "text",
  hint,
  required = false,
  min,
  max,
  step,
  placeholder,
  rows,
  disabled = false,
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  hint?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <TextField
      className="field"
      value={String(value)}
      onChange={onChange}
      isRequired={required}
      isDisabled={disabled}
    >
      <Label>{label}</Label>
      {rows ? (
        <TextArea rows={rows} placeholder={placeholder} />
      ) : (
        <Input
          type={type as "text"}
          min={min}
          max={max}
          step={type === "number" ? (step ?? ".25") : undefined}
          placeholder={placeholder}
        />
      )}{" "}
      {hint && <Description>{hint}</Description>}
    </TextField>
  );
}
export function Pick({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; label: string }[];
  hint?: string;
}) {
  return (
    <Select
      className="field"
      aria-label={label}
      value={value || null}
      onChange={(v) => onChange(String(v ?? ""))}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              {o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
      {hint && <Description>{hint}</Description>}
    </Select>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
  wide = false,
  panel = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
  panel?: boolean;
}) {
  return (
    <Modal.Backdrop
      isOpen={open}
      onOpenChange={(v) => !v && onClose()}
      className={panel ? "feature-editor-backdrop" : undefined}
    >
      <Modal.Container
        size="lg"
        scroll="inside"
        className={panel ? "feature-editor-container" : undefined}
      >
        <Modal.Dialog
          className={
            panel
              ? "dialog feature-editor-panel"
              : wide
                ? "dialog dialog-wide"
                : "dialog"
          }
        >
          <Modal.CloseTrigger aria-label="Close dialog" />
          <Modal.Header>
            <Modal.Heading>{title}</Modal.Heading>
          </Modal.Header>
          <Modal.Body>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
export function Weekends({
  value,
  onChange,
}: {
  value: number[];
  onChange: (v: number[]) => void;
}) {
  return (
    <div className="weekday-picker" aria-label="Weekend days">
      {weekdays.map((d, i) => (
        <Button
          key={d}
          size="sm"
          variant={value.includes(i) ? "primary" : "outline"}
          aria-label={`${d} weekend`}
          aria-pressed={value.includes(i)}
          onPress={() =>
            onChange(
              value.includes(i) ? value.filter((n) => n !== i) : [...value, i],
            )
          }
        >
          {d}
        </Button>
      ))}
    </div>
  );
}
export function Avatar({
  name,
  color = "#7565db",
  small = false,
}: {
  name: string;
  color?: string;
  small?: boolean;
}) {
  return (
    <span
      className={`avatar ${small ? "small" : ""}`}
      style={{ background: color + "19", color }}
    >
      {name
        .split(" ")
        .filter(Boolean)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")}
    </span>
  );
}
export function Empty({
  title,
  detail,
  action,
}: {
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-symbol">↗</span>
      <h3>{title}</h3>
      <p>{detail}</p>
      {action}
    </div>
  );
}
export function ErrorText({ text }: { text: string }) {
  return text ? (
    <div className="form-error" role="alert">
      {text}
    </div>
  ) : null;
}
export function Check({
  label,
  ariaLabel,
  checked,
  onChange,
}: {
  label: string;
  ariaLabel?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="check">
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
