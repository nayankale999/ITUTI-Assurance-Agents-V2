import { AuthBrand, AuthFoot } from '@/components/Brand';
import Link from 'next/link';
export default function NotFound() {
  return (
    <main className="auth">
      <AuthBrand /><section className="panel"><header><h2>Page not found</h2></header>
      <div className="body"><p>This page does not exist, or you do not have access to it.</p><Link className="btn" href="/">Go to your home page</Link></div></section><AuthFoot /></main>
  );
}
