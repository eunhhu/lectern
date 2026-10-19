// Thin, token-styled wrappers over React Aria Components (DESIGN.md §3). Focus,
// keyboard, ARIA and IME handling come from React Aria; these only add classes.

import type { Key, ReactNode } from "react";
import {
  Button as AriaButton,
  type ButtonProps as AriaButtonProps,
  Checkbox as AriaCheckbox,
  type CheckboxProps,
  Dialog,
  Heading,
  Label,
  ListBox,
  ListBoxItem,
  Modal,
  ModalOverlay,
  Popover,
  ProgressBar,
  Select,
  SelectValue,
  Switch as AriaSwitch,
  type SwitchProps,
  Text,
} from "react-aria-components";
import { Icon, type IconName } from "./Icon.tsx";
import s from "./ui.module.css";

export type Tone = "neutral" | "success" | "attention" | "severe" | "danger" | "info" | "accent";

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(" ");

export interface ButtonProps extends Omit<AriaButtonProps, "className" | "children"> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "dangerText";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  /** Icon-only buttons need `aria-label`. */
  iconOnly?: boolean;
  className?: string;
  children?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", icon, iconOnly, className, children, ...rest }: ButtonProps) {
  return (
    <AriaButton {...rest} className={cx(s.button, s[variant], size !== "md" && s[size], iconOnly && s.iconOnly, className)}>
      {icon && <Icon name={icon} size={size === "sm" ? 14 : 16} />}
      {iconOnly ? null : children}
    </AriaButton>
  );
}

export function Badge({ tone = "neutral", children, dot }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={s.badge} data-tone={tone}>
      {dot && <span className={s.dot} data-tone={tone} />}
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", live }: { tone?: Tone; live?: boolean }) {
  return <span className={s.dot} data-tone={tone} data-live={live || undefined} aria-hidden="true" />;
}

export function Kbd({ keys }: { keys: string[] }) {
  return (
    <span className={s.kbdGroup}>
      {keys.map((k) => (
        <kbd key={k} className={s.kbd}>
          {k}
        </kbd>
      ))}
    </span>
  );
}

export function EmptyState({
  icon,
  tone,
  title,
  children,
  action,
}: {
  icon: IconName;
  tone?: "success";
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={s.empty}>
      <span className={s.emptyIcon} data-tone={tone}>
        <Icon name={icon} size={24} />
      </span>
      <p className={s.emptyTitle}>{title}</p>
      {children && <p className={s.emptyText}>{children}</p>}
      {action}
    </div>
  );
}

export function ErrorBox({ title, children, onRetry }: { title: string; children?: ReactNode; onRetry?: () => void }) {
  return (
    <div className={s.errorBox} role="alert">
      <p className={s.errorTitle}>
        <Icon name="alert" />
        {title}
      </p>
      {children && <p>{children}</p>}
      {onRetry && (
        <Button size="sm" onPress={onRetry}>
          다시 시도
        </Button>
      )}
    </div>
  );
}

export function Spinner({ label = "불러오는 중…" }: { label?: string }) {
  return <span className={s.spinner} role="status" aria-label={label} />;
}

export function Skeleton({ width = "100%" }: { width?: string }) {
  return <span className={s.skeleton} data-width={width} aria-hidden="true" ref={(el) => el?.style.setProperty("width", width)} />;
}

export function Progress({ value, label, valueLabel }: { value: number; label: string; valueLabel: string }) {
  return (
    <ProgressBar className={s.progress} value={value * 100} aria-label={label} valueLabel={valueLabel}>
      {({ percentage }) => (
        <>
          <span className={s.progressLabel}>{valueLabel}</span>
          <span className={s.progressTrack}>
            <span className={s.progressFill} ref={(el) => el?.style.setProperty("width", `${percentage ?? 0}%`)} />
          </span>
        </>
      )}
    </ProgressBar>
  );
}

export function ModalDialog({
  isOpen,
  onOpenChange,
  title,
  size,
  role,
  isDismissable = true,
  children,
  footer,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  size?: "form" | "wide";
  role?: "dialog" | "alertdialog";
  isDismissable?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <ModalOverlay className={s.scrim} isOpen={isOpen} onOpenChange={onOpenChange} isDismissable={isDismissable}>
      <Modal className={s.modal} data-size={size}>
        <Dialog className={s.dialog} role={role}>
          <div className={s.dialogHeader}>
            <Heading slot="title" className={s.dialogTitle}>
              {title}
            </Heading>
            <Button variant="ghost" size="sm" icon="close" iconOnly aria-label="닫기" slot="close" />
          </div>
          <div className={s.dialogBody}>{children}</div>
          {footer && <div className={s.dialogFooter}>{footer}</div>}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function SelectField<T extends { id: string; label: string }>({
  label,
  items,
  selectedKey,
  onSelectionChange,
  hideLabel,
  description,
}: {
  label: string;
  items: T[];
  selectedKey: string | null;
  onSelectionChange: (key: string) => void;
  hideLabel?: boolean;
  description?: string;
}) {
  return (
    <Select
      className={s.field}
      selectedKey={selectedKey}
      onSelectionChange={(key: Key | null) => key !== null && onSelectionChange(String(key))}
      aria-label={hideLabel ? label : undefined}
    >
      {!hideLabel && <Label className={s.label}>{label}</Label>}
      <AriaButton className={s.selectButton}>
        <SelectValue className={s.selectValue} />
        <Icon name="chevronDown" size={14} />
      </AriaButton>
      {description && (
        <Text slot="description" className={s.hint}>
          {description}
        </Text>
      )}
      <Popover className={s.popover}>
        <ListBox className={s.listbox} items={items}>
          {(item) => (
            <ListBoxItem id={item.id} textValue={item.label} className={s.option}>
              {({ isSelected }) => (
                <>
                  {item.label}
                  {isSelected && (
                    <span className={s.optionCheck}>
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </>
              )}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </Select>
  );
}

export function CheckboxField({ children, ...props }: Omit<CheckboxProps, "className" | "children"> & { children?: ReactNode }) {
  return (
    <AriaCheckbox {...props} className={s.checkbox}>
      {({ isIndeterminate, isSelected }) => (
        <>
          <span className={s.checkboxBox}>
            {isIndeterminate ? (
              <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                <path d="M2 5h6" stroke="currentColor" strokeWidth="1.6" />
              </svg>
            ) : (
              isSelected && <Icon name="check" size={12} />
            )}
          </span>
          {children}
        </>
      )}
    </AriaCheckbox>
  );
}

export function SwitchField({ children, ...props }: Omit<SwitchProps, "className" | "children"> & { children: ReactNode }) {
  return (
    <AriaSwitch {...props} className={s.switch}>
      <span className={s.switchTrack}>
        <span className={s.switchThumb} />
      </span>
      {children}
    </AriaSwitch>
  );
}

export const uiStyles = s;
export { cx };
