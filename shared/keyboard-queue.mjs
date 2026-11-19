// Bound keyboard bursts below the peer's command limit. Never retry input after a failed send.
export class KeyboardQueue {
  items = [];
  timer = null;
  constructor(send, changed, failed) { this.send = send; this.changed = changed; this.failed = failed; }
  get pending() { return this.items.length; }
  enqueue(commands) {
    const cost = command => command.action === 'type' ? command.text.length : 1;
    if (commands.length + this.items.length > 256 || [...this.items, ...commands].reduce((sum, command) => sum + cost(command), 0) > 4096) {
      this.failed('Too much keyboard input is pending. Send a smaller section.'); return false;
    }
    this.items.push(...commands); this.changed();
    if (!this.timer) this.drain();
    return true;
  }
  drain() {
    let count = 0;
    while (this.items.length && count++ < 8) {
      const command = this.items.shift();
      try {
        if (!this.send(command)) { this.cancel(); this.failed('Keyboard input stopped. Reconnect before typing again; pending input was discarded.'); return; }
      } catch { this.cancel(); this.failed('Keyboard input stopped; pending input was discarded.'); return; }
    }
    this.timer = setTimeout(() => { this.timer = null; if (this.items.length) this.drain(); }, 80);
    this.changed();
  }
  cancel(notify = true) { clearTimeout(this.timer); this.timer = null; this.items = []; if (notify) this.changed(); }
}
