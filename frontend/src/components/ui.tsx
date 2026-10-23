"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { X, type LucideIcon } from "lucide-react";
import type { RiskLevel } from "@/lib/simulation/types";

export function Badge({
  children,
  tone = "neutral",
  dot = false,
}: {
  children: ReactNode;
  tone?: RiskLevel | "cyan" | "neutral";
  dot?: boolean;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      {dot && <span className="status-dot" />}
      {children}
    </span>
  );
}
export function PanelHeading({
  icon: Icon,
  title,
  children,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  subtitle?: string;
}) {
  return (
    <div className="panel-heading">
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <Icon size={16} className="text-muted shrink-0" />
          <h2>{title}</h2>
        </div>
        {subtitle && <p className="panel-subtitle">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
export function IconButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      <Icon size={17} />
      {children}
    </button>
  );
}
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    if (open && !el?.open) el?.showModal();
    else if (!open && el?.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="app-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-body">
        <div className="flex items-center justify-between gap-4 mb-5">
          <h2 id={titleId}>{title}</h2>
          <IconButton icon={X} label="Close dialog" onClick={onClose} />
        </div>
        {children}
      </div>
    </dialog>
  );
}
