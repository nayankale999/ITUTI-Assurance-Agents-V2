'use client';
import { useActionState, useEffect, useRef, useState } from 'react';
import type { ActionState } from '@/app/actions';

type Action = (state: ActionState, fd: FormData) => Promise<ActionState>;

/** A form bound to a server action, showing the action's result message beside its controls. */
export function ActionForm({ action, children, className, resetOnSuccess, confirm, style }: {
  action: Action; children: React.ReactNode; className?: string; resetOnSuccess?: boolean; confirm?: string; style?: React.CSSProperties;
}) {
  const [state, run, pending] = useActionState(action, null);
  const [armed, setArmed] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnSuccess) ref.current?.reset(); setArmed(false); }, [state, resetOnSuccess]);
  return (
    <form
      ref={ref}
      action={run}
      className={className}
      style={style}
      onSubmit={e => { if (confirm && !armed) { e.preventDefault(); setArmed(true); } }}
      aria-busy={pending}
    >
      {children}
      {confirm && armed && <span className="err" role="alert">{confirm} Press the button again to confirm.</span>}
      {state?.error && <span className="err" role="alert">{state.error}</span>}
      {state?.ok && <span className="ok" role="status">{state.ok}</span>}
    </form>
  );
}

export function Submit({ children, className = 'btn', disabled }: { children: React.ReactNode; className?: string; disabled?: boolean }) {
  return <button className={className} disabled={disabled}>{children}</button>;
}
