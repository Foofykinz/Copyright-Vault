import type { ReactNode } from "react";

export function StateBlock({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="state-block">
      <div className="state-block-title">{title}</div>
      {children}
    </div>
  );
}

export function LoadingBlock({ label = "Loading…" }: { label?: string }) {
  return <div className="state-block">{label}</div>;
}

export function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="state-block">
      <div className="state-block-title">Something went wrong</div>
      <div className="error-text">{message}</div>
    </div>
  );
}
