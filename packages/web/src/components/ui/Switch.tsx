/**
 * An on/off switch for a setting that applies at once (refs: Replit's and Higgsfield's settings rows): a
 * 36×20 pill, Paper White when on. Name it with a `<label htmlFor>` (a button is labelable) and describe
 * it with `aria-describedby`.
 */
export function Switch({
  checked,
  onChange,
  ...rest
}: { checked: boolean; onChange(next: boolean): void } & Pick<React.ButtonHTMLAttributes<HTMLButtonElement>, "id" | "disabled" | "aria-describedby">) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch" onClick={() => onChange(!checked)} {...rest}>
      <span className="switch-knob" aria-hidden />
    </button>
  );
}
