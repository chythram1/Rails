export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="page center">
      <h1 className="page-title">{title}</h1>
      <p className="muted">{body} Not built yet.</p>
    </div>
  );
}
