import { KeyboardQueue } from '../../shared/keyboard-queue.mjs';
import type { Connection } from './connection';
import type { Command } from './types';
import type { Modifier } from './keymap';

/**
 * One ordered path for every command a phone sends during a session.
 * Typed characters are batched briefly; pointer and app commands that arrive
 * while keyboard input is still queued wait behind it, so a click never lands
 * before the text that was typed first.
 */
export class RemoteInput {
  private buffer = '';
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: KeyboardQueue;
  enabled = false;

  constructor(private connection: Connection) {
    this.queue = new KeyboardQueue(
      (command: Command) => this.enabled && connection.sendCommand(command),
      () => {}, (message: string) => connection.report(Error(message)),
    );
  }

  /** Types text into the focused Mac field. */
  type = (text: string) => {
    if (!this.enabled || !text) return false;
    this.buffer += text;
    if (this.buffer.length >= 256) return this.flush();
    if (!this.timer) this.timer = setTimeout(this.flush, 40);
    return true;
  };

  flush = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const text = this.buffer; this.buffer = '';
    return !text || this.queue.enqueue([{ action: 'type', text }]);
  };

  key = (code: number, modifiers: readonly Modifier[] = []) => {
    if (!this.enabled) return false;
    this.flush();
    return this.queue.enqueue([{ action: 'key', code, modifiers: [...modifiers] }]);
  };

  /** Pointer, scroll and app commands. */
  send = (command: Command) => {
    if (!this.enabled) return false;
    this.flush();
    return this.queue.pending ? this.queue.enqueue([command]) : this.connection.sendCommand(command);
  };

  /** Discards input that has not reached the Mac yet. */
  cancel = () => {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null; this.buffer = ''; this.queue.cancel(false);
  };
}
