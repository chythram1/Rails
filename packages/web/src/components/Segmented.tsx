import type { ReactNode } from "react";

/**
 * A choice of a few, as square segments in one ruled box, the chosen one blue.
 * Native radios underneath: Tab reaches the group, the arrow keys move the choice, and screen readers hear a
 * radio group. Name it with `aria-labelledby`.
 */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  ...aria
}: {
  name: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange(value: T): void;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "aria-labelledby" | "aria-describedby">) {
  return (
    <div className="segmented" role="radiogroup" {...aria}>
      {options.map((o) => (
        <label key={o.value} className="segment">
          <input type="radio" name={name} value={o.value} checked={o.value === value} onChange={() => onChange(o.value)} />
          {o.icon}
          {o.label}
        </label>
      ))}
    </div>
  );
}
