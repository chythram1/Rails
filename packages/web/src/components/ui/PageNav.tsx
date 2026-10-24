import type { ReactNode } from "react";

export interface PageNavItem {
  href: string;
  label: string;
  icon: ReactNode;
  current: boolean;
}

/**
 * A page with its own tabs in a column beside it (Customize, Automate): the page's name (its h1) over the tabs as
 * links, then the tab's content, which starts with its own h2 title. Narrower, the tabs go above it as a row.
 */
export function PageNav({ id, title, items, children }: { id: string; title: string; items: PageNavItem[]; children: ReactNode }) {
  return (
    <div className="cz-page-inner cz-layout">
      <nav className="cz-nav" aria-labelledby={`${id}-nav-title`}>
        <h1 id={`${id}-nav-title`} className="cz-nav-title">
          {title}
        </h1>
        <ul>
          {items.map((t) => (
            <li key={t.href}>
              <a href={t.href} className="cz-nav-item" aria-current={t.current ? "page" : undefined}>
                <span aria-hidden>{t.icon}</span>
                {t.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="cz-main">{children}</div>
    </div>
  );
}
