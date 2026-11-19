import { useEffect } from 'react';
import { Header } from '@/components/sections/header';
import { Hero } from '@/components/sections/hero';

/** Public landing page shown to signed-out visitors on the web at `/`. */
export function Landing() {
  useEffect(() => { document.title = 'Remotely · Your whole Mac, right in your pocket'; }, []);
  return <div className="dark min-h-dvh overflow-x-clip bg-background text-foreground">
    <a className="skip-link" href="#main-content">Skip to main content</a>
    <Header />
    <main id="main-content" tabIndex={-1}>
      <Hero />
    </main>
  </div>;
}
