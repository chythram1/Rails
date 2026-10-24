import type { ReactNode } from "react";

/**
 * A choice of a few, as square segments in one ruled box, the chosen one blue.
 * Native radios underneath: Tab reaches the group, the arrow keys move the choice, and screen readers hear a
 * radio group. Name it with `aria-labelledby`. `small` is the compact size, for a control on every row of a list.
 * A value none of the options has leaves all of them unchosen (e.g. a "set all" over mixed rows).
 */
export function Segmented<T extends string>({
  name,
  value,
  options,
  onChange,
  small,
  ...aria
}: {
  name: string;
  value: T;
  options: { value: T; label: string; icon?: ReactNode }[];
  onChange(value: T): void;
  small?: boolean;
} & Pick<React.HTMLAttributes<HTMLDivElement>, "aria-labelledby" | "aria-describedby">) {
  return (
    <div className={small ? "segmented small" : "segmented"} role="radiogroup" {...aria}>
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
