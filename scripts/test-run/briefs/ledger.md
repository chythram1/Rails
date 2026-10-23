# Ledger: brief

A personal budget app for the browser. Plain JavaScript ES modules and the DOM: no dependencies, no
frameworks, no build step. Data lives in localStorage. It's served as static files from the project
folder; don't start a server.

## What it does

- **Transactions:** add, edit and delete them (date, amount, payee, category, note). Spending is negative,
  income positive. A list with filters (month, category, text search) and a running total.
- **Categories:** a starting set (Groceries, Rent, Transport, Eating out, Fun, Income, Other), each with a
  colour; the user can add, rename and recolour them. Deleting one moves its transactions to Other.
- **Budgets:** a monthly limit per category, and how much of it this month's spending has used (under 80%
  fine, 80-100% close, over 100% over).
- **Recurring:** rules like "Rent, -1200.00, every month on the 1st" or "Bus pass, -30.00, every week on
  Monday"; their transactions appear by themselves when their date comes.
- **Import and export:** CSV with the columns `date,amount,payee,category,note` (a header row; dates as
  YYYY-MM-DD; amounts like -12.50). Import shows a preview with the rows it can't read before it adds
  anything.
- **Dashboard:** this month's income, spending and balance, spending by category as an SVG donut, the
  budgets that are close or over, and the last 5 transactions.

## Screens

Hash routes: `#/` dashboard, `#/transactions`, `#/transactions/new`, `#/transactions/:id`, `#/budgets`,
`#/categories`, `#/recurring`, `#/import`. A top bar with the app name and links to each. Readable on a
phone (one column under 640 px). Money shown as `$1,234.56` and `-$12.50`.

## Architecture and who owns what

| Path | Owner | What |
| --- | --- | --- |
| `index.html`, `styles.css`, `src/main.js` | app (Claude Code) | page, boot, wiring |
| `src/app/` | app (Claude Code) | `store.js` (state, actions, persistence), `router.js` (hash routes), `events.js` (event bus), `dom.js` (element helpers) |
| `src/domain/` | domain (Codex) | `money.js`, `transactions.js`, `categories.js`, `budgets.js`, `recurring.js`, `csv.js` |
| `src/views/` | views (pi) | `dashboard.js`, `transactions.js`, `form.js`, `budgets.js`, `categories.js`, `recurring.js`, `import.js`, `charts.js` |
| `tests/` | each owner, one file per module | `node --test` unit tests of pure logic |

## Contracts

- Amounts are integer cents everywhere in state and in the domain (`-1250` is -$12.50).
  `src/domain/money.js` has `parseMoney("−12.50") → -1250` and `formatMoney(-1250) → "-$12.50"`.
- `src/app/schema.js` (shared): `createState()` returns `{ version: 1, transactions: [], categories: [],
  budgets: {}, recurring: [], settings: { currency: "USD" } }`. A transaction is
  `{ id, date: "YYYY-MM-DD", amount, payee, categoryId, note }`.
- The domain is pure: functions take state or plain data and return new values; no DOM, no storage.
- `src/app/store.js`: `getState()`, `dispatch(action)` with `{ type, ...payload }` actions
  (`tx/add`, `tx/update`, `tx/delete`, `category/add`, `category/update`, `category/delete`, `budget/set`,
  `recurring/add`, `recurring/delete`, `import/commit`), `subscribe(fn)`. It saves to localStorage.
- `src/app/events.js`: `on(name, fn)` (returns an unsubscribe function), `emit(name, data)`. Events:
  `state:changed`, `route:changed`, `toast {text}`.
- Each view exports `render(root, state, { dispatch, navigate, params })` and redraws `root` itself.

## Rules for every session

- Work in the files you own. For shared files (`src/main.js`, `index.html`, `src/app/schema.js`) make
  small, additive changes, and say what you changed.
- Don't commit: I commit at milestones.
- Don't start servers. Check your work with `node --check <file>` and `node --test tests/*.test.js`.
- When you finish a step, end with a short summary of what's done and what others can now use.
