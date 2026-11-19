import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { KeyboardQueue } from '../../shared/keyboard-queue.mjs';
import type { Connection } from '@/lib/connection';

const shortcuts = [
  ['Tab', 48, [], 'Move focus forward'], ['Shift Tab', 48, ['shift'], 'Move focus backward'],
  ['Next tab', 48, ['ctrl'], 'Next tab (Control Tab)'], ['Prev tab', 48, ['ctrl', 'shift'], 'Previous tab (Control Shift Tab)'],
  ['⌘ A', 0, ['cmd'], 'Select all (Command A)'], ['⌘ Space', 49, ['cmd'], 'Open Spotlight (Command Space)'],
  ['⌘ Tab', 48, ['cmd'], 'Switch apps (Command Tab)'], ['⌘ ⇧ Tab', 48, ['cmd', 'shift'], 'Previous app (Command Shift Tab)'],
  ['⌘ C', 8, ['cmd'], 'Copy (Command C)'], ['⌘ V', 9, ['cmd'], 'Paste on Mac (Command V)'],
  ['⌘ X', 7, ['cmd'], 'Cut (Command X)'], ['⌘ Z', 6, ['cmd'], 'Undo (Command Z)'], ['⌘ ⇧ Z', 6, ['cmd', 'shift'], 'Redo (Command Shift Z)'],
  ['⌘ S', 1, ['cmd'], 'Save (Command S)'], ['⌘ F', 3, ['cmd'], 'Find (Command F)'], ['⌘ T', 17, ['cmd'], 'New tab (Command T)'],
  ['⌘ W', 13, ['cmd'], 'Close tab or window (Command W)'], ['Mac fullscreen', 3, ['ctrl', 'cmd'], 'Toggle active Mac app fullscreen (Control Command F)'],
  ['Escape', 53, [], 'Escape'], ['Return', 36, [], 'Return'], ['Shift Return', 36, ['shift'], 'Shift Return'], ['Delete', 51, [], 'Delete backward'],
] as const;
const arrows = [[ArrowLeft, 123, 'Left arrow key'], [ArrowUp, 126, 'Up arrow key'], [ArrowDown, 125, 'Down arrow key'], [ArrowRight, 124, 'Right arrow key']] as const;

export function RemoteKeyboard({ connection, connected, onBusyChange }: { connection: Connection; connected: boolean; onBusyChange(busy: boolean): void }) {
  const [text, setText] = useState(''); const [live, setLive] = useState(false); const [busy, setBusy] = useState(false);
  const textRef = useRef(''); const composing = useRef(false); const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabled = useRef(connected); enabled.current = connected;
  const input = useRef<HTMLTextAreaElement>(null);
  const hintId = useId(); const liveId = useId();
  const notifyRef = useRef<() => void>(() => {});
  const queue = useMemo(() => new KeyboardQueue(
    command => enabled.current && connection.sendCommand(command),
    () => notifyRef.current(), message => connection.report(Error(message)),
  ), [connection]);
  const updateText = (value: string) => { textRef.current = value; setText(value); };
  const notify = () => { const pending = !!commitTimer.current || queue.pending > 0 || composing.current && !!textRef.current; setBusy(pending); onBusyChange(pending); };
  notifyRef.current = notify;
  const cancelCommit = () => { clearTimeout(commitTimer.current!); commitTimer.current = null; };
  const commit = () => {
    cancelCommit();
    if (!enabled.current || composing.current) { notify(); return false; }
    const value = textRef.current;
    if (!value) { notify(); return true; }
    if (!queue.enqueue([{ action: 'type', text: value }])) { notify(); return false; }
    updateText(''); notify(); return true;
  };
  const schedule = () => {
    if (!commitTimer.current && !composing.current && textRef.current) commitTimer.current = setTimeout(commit, 120);
    notify();
  };
  const sendKey = (code: number, modifiers: readonly string[] = []) => {
    if (!connected || live && !commit()) return;
    queue.enqueue([{ action: 'key', code, modifiers: [...modifiers] }]);
  };
  useEffect(() => {
    const element = input.current;
    const beforeInput = (event: InputEvent) => {
      if (live && enabled.current && !composing.current && !textRef.current && event.inputType === 'deleteContentBackward' && event.cancelable) {
        event.preventDefault(); queue.enqueue([{ action: 'key', code: 51, modifiers: [] }]);
      }
    };
    element?.addEventListener('beforeinput', beforeInput);
    return () => element?.removeEventListener('beforeinput', beforeInput);
  }, [live, queue]);
  useEffect(() => {
    if (!connected) { cancelCommit(); composing.current = false; queue.cancel(); if (live) updateText(''); notify(); }
  }, [connected]);
  useEffect(() => () => { cancelCommit(); queue.cancel(false); onBusyChange(false); }, [queue, onBusyChange]);
  return <>
    <div className="eyebrow mb-3">Send text to your Mac</div>
    <label htmlFor={liveId} className="live-typing-toggle"><input id={liveId} type="checkbox" checked={live} disabled={!connected || composing.current} onChange={event => { cancelCommit(); setLive(event.target.checked); if (event.target.checked) schedule(); else notify(); }} />Live typing</label>
    <Textarea ref={input} rows={4} value={text} onChange={event => { updateText(event.target.value); if (live) schedule(); }} onCompositionStart={() => { composing.current = true; cancelCommit(); notify(); }} onCompositionEnd={event => { composing.current = false; updateText(event.currentTarget.value); if (live) schedule(); else notify(); }} onBlur={() => { if (live && !composing.current) commit(); }} onKeyDown={event => {
      if (!live || composing.current || event.nativeEvent.isComposing || textRef.current) return;
      const keys: Record<string, number> = { Backspace: 51, ArrowLeft: 123, ArrowUp: 126, ArrowDown: 125, ArrowRight: 124 };
      if (keys[event.key] !== undefined) { event.preventDefault(); sendKey(keys[event.key], [event.shiftKey && 'shift', event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt'].filter(Boolean) as string[]); }
    }} placeholder={live ? 'Type here to send as you type…' : 'Type or paste multiple lines…'} aria-label="Text to send" aria-describedby={hintId} maxLength={4096} disabled={!connected} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
    <p id={hintId} className="mt-2 text-sm leading-5 text-muted-foreground">{live ? 'Text sends about every 120 ms and this input pad clears after sending. Backspace and arrows edit on your Mac when the pad is empty. Tab moves focus out of this pad.' : 'Enter adds a new line here. Send text writes the whole message to the focused field on your Mac.'} Select the target app or field on your Mac first.</p>
    <div className="keyboard-send-row"><Button variant="outline" onClick={commit} disabled={!connected || !text || composing.current}><Send size={16} aria-hidden="true" />Send text</Button><span role="status" className="text-xs text-muted-foreground">{!connected ? 'Typing paused' : busy ? 'Sending input…' : live ? 'Live typing is on' : 'Send when ready'}</span></div>
    <div className="eyebrow mb-3 mt-6">Common shortcuts</div><div className="shortcut-grid">{shortcuts.map(([label, code, modifiers, name]) => <Button variant="outline" className="px-1 text-xs whitespace-normal" key={label} aria-label={`${label}: ${name}`} disabled={!connected} onClick={() => sendKey(code, modifiers)}>{label}</Button>)}</div>
    <p className="mt-3 text-sm leading-5 text-muted-foreground">Next tab and Prev tab act in the active Mac app. Mac fullscreen toggles that app’s fullscreen window.</p>
    <div className="mt-3 grid grid-cols-4 gap-2">{arrows.map(([Arrow, code, label]) => <Button variant="secondary" key={code} disabled={!connected} aria-label={label} onClick={() => sendKey(code)}><Arrow size={16} aria-hidden="true" /></Button>)}</div>
  </>;
}
