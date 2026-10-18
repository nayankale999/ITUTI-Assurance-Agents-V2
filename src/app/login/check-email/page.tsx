export const metadata = { title: 'Check your email' };

export default function CheckEmail() {
  return (
    <main className="auth">
      <section className="panel">
        <header><h2>Check your email</h2></header>
        <div className="body">
          <p>If your address has access, a sign-in link is on its way. It works once and expires in 15 minutes.</p>
          <p className="muted">Nothing arrived? Check your junk folder, then ask your Ituti contact to confirm your invitation.</p>
        </div>
      </section>
    </main>
  );
}
