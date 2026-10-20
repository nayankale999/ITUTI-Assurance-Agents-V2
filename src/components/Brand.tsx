import { HomeLink } from './HomeLink';

export const SITE_URL = 'https://www.ituti.tech';

export function Brand() {
  return (
    <HomeLink>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/ituti-icon.svg" alt="" width={23} height={34} />
      <span style={{ display: 'grid', textAlign: 'left', lineHeight: 1.15 }}><b>ITUTI<i>.</i></b><span className="sub">AI Assurance</span></span>
    </HomeLink>
  );
}

export function AuthBrand() {
  return (
    <a className="auth-brand" href={SITE_URL}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/ituti-icon.svg" alt="" width={27} height={40} />
      <span style={{ display: 'grid', lineHeight: 1.15 }}><b>ITUTI<i>.</i></b><span className="lbl">AI Assurance</span></span>
    </a>
  );
}

export function AuthFoot() {
  return <p className="auth-foot">Ituti AI Assurance is run by <a href={SITE_URL}>ITUTI Tech</a>. Need access? <a href={`${SITE_URL}/contact.html`}>Contact us</a>.</p>;
}

export function SiteFoot() {
  return (
    <footer className="site-foot">
      <div className="wrap">
        <span>© {new Date().getFullYear()} ITUTI Tech Ltd</span>
        <a href={SITE_URL}>ituti.tech</a>
        <a href={`${SITE_URL}/ai-assurance.html`}>About the platform</a>
        <a href={`${SITE_URL}/contact.html`}>Contact</a>
        <span className="spacer" />
        <span>Classification is an indication, not legal advice.</span>
      </div>
    </footer>
  );
}
