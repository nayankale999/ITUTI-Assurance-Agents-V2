'use client';
import { AuthBrand, AuthFoot } from '@/components/Brand';
export default function Error() {
  return (
    <main className="auth">
      <AuthBrand /><section className="panel"><header><h2>Something went wrong</h2></header>
      <div className="body"><p>The page could not load. If the app was updated while you had this page open, reloading fixes it. If it keeps happening, tell your Ituti contact.</p><button className="btn" onClick={() => window.location.reload()}>Reload the page</button></div></section><AuthFoot /></main>
  );
}
