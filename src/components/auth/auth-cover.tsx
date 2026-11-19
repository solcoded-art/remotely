import { memo } from 'react';
import { Dithering } from '@paper-design/shaders-react';
import { useReducedMotion } from 'motion/react';

import { MacDesktop } from '@/components/hero/mac-desktop';
import { PhoneRemoteScreen } from '@/components/hero/phone-remote-screen';
import { IPhone17ProMax } from '@/components/ui/apple-iphone-17-pro';
import { MacBookPro } from '@/components/ui/apple-macbook-pro';

const MemoDithering = memo(Dithering);

/** Cover panel for the sign-in page (signup-02's image column): dithering + device pair. */
export function AuthCover() {
  const reduceMotion = useReducedMotion();

  return (
    <div
      aria-hidden="true"
      className="relative hidden overflow-hidden border-l border-white/[0.06] bg-brand-950 lg:flex lg:flex-col lg:items-center lg:justify-center"
      inert
    >
      <div
        className="absolute inset-0 opacity-60"
        style={{ maskImage: 'radial-gradient(85% 70% at 50% 40%, black 30%, transparent 85%)' }}
      >
        <MemoDithering
          colorBack="#00000000"
          colorFront="#5b6cf0"
          scale={0.7}
          shape="warp"
          size={2}
          speed={reduceMotion ? 0 : 0.35}
          style={{ height: '100%', width: '100%' }}
          type="4x4"
        />
      </div>

      <div className="relative w-[78%] max-w-xl">
        <div className="pr-[14%] pb-[8%]">
          <MacBookPro>
            <MacDesktop />
          </MacBookPro>
        </div>
        <div className="absolute right-0 bottom-0 [zoom:0.36] xl:[zoom:0.44]">
          <IPhone17ProMax appearance="dark" className="p-0">
            <PhoneRemoteScreen />
          </IPhone17ProMax>
        </div>
      </div>

      <div className="relative mt-12 max-w-sm px-6 text-center">
        <p className="text-lg font-semibold tracking-tight text-balance">
          Your whole Mac.{' '}
          <span className="bg-gradient-to-b from-brand-200 to-brand-400 bg-clip-text text-transparent">
            Right in your pocket.
          </span>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          One account for your Mac and iPhone. Pick up exactly where you left off.
        </p>
      </div>
    </div>
  );
}
