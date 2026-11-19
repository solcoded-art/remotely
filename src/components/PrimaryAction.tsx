import type { ComponentProps } from 'react';
import { HaloButton } from '@/components/ui/halo-button';
import { cn } from '@/lib/utils';

export function PrimaryAction({ className, ...props }: ComponentProps<typeof HaloButton>) {
  return <HaloButton translucent={false} staggerLabel={false} animateLayout={false} className={cn('primary-action', className)} {...props} />;
}
