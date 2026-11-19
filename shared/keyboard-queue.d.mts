import type { Command } from '../src/lib/types';
export class KeyboardQueue {
  constructor(send: (command: Command) => boolean, changed: () => void, failed: (message: string) => void);
  readonly pending: number;
  enqueue(commands: Command[]): boolean;
  cancel(notify?: boolean): void;
}
