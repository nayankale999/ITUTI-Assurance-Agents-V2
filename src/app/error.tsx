'use client';
export default function Error({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="auth"><section className="panel"><header><h2>Something went wrong</h2></header>
      <div className="body"><p>The page could not load. Try again, and if it keeps happening, tell your Ituti contact.</p><button className="btn" onClick={reset}>Try again</button></div></section></main>
  );
}
