import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowBigUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Delete, Keyboard, Smartphone, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { chordFor, hotkeyCombo, hotkeySpoken, keyCode, MODIFIER_NAME, MODIFIER_SYMBOL, SPECIAL_KEYS, type Modifier } from '@/lib/keymap';
import { usePreferences } from '@/lib/preferences';
import type { RemoteInput } from '@/lib/remote-input';

const LAYERS = {
  letters: [['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['z', 'x', 'c', 'v', 'b', 'n', 'm', ',', '.']],
  numbers: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['-', '/', ':', ';', '(', ')', '$', '&', '@'], ['"', "'", '?', '!', '.', ',', '`', '~', '#']],
  symbols: [['[', ']', '{', '}', '#', '%', '^', '*', '+', '='], ['_', '\\', '|', '<', '>', '€', '£', '¥', '•'], ['"', "'", '?', '!', '.', ',', '`', '~', '…']],
} as const;
type Layer = keyof typeof LAYERS;

/** A key that fires on pointer down (snappy on phones) and repeats while held when `repeat` is set. */
function Key({ label, children, onPress, repeat, pressed, wide, className, disabled }: { label: string; children: ReactNode; onPress(): void; repeat?: boolean; pressed?: boolean; wide?: number; className?: string; disabled?: boolean }) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null); const fromPointer = useRef(false);
  const press = useRef(onPress); press.current = onPress;
  const stop = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => stop, []);
  return <button type="button" aria-label={label} aria-pressed={pressed} disabled={disabled} style={wide ? { flexGrow: wide } : undefined} className={cn('kb-key', className)}
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault(); fromPointer.current = true; press.current();
      if (repeat) { const tick = (delay: number) => { timer.current = setTimeout(() => { press.current(); tick(60); }, delay); }; tick(420); }
    }}
    onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} onContextMenu={event => event.preventDefault()}
    // Keyboard and assistive-technology activation arrive as clicks without a pointer down.
    onClick={() => { if (fromPointer.current) { fromPointer.current = false; return; } press.current(); }}>{children}</button>;
}

/** Invisible field that opens the phone's own keyboard for dictation, emoji, IME and paste. */
function PhoneKeyboardField({ input, enabled, field }: { input: RemoteInput; enabled: boolean; field: React.RefObject<HTMLTextAreaElement | null> }) {
  const composing = useRef(false); const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commit = () => {
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    const element = field.current; if (!element || composing.current || !element.value) return;
    if (input.type(element.value)) input.flush();
    element.value = '';
  };
  useEffect(() => {
    const element = field.current; if (!element) return;
    const beforeInput = (event: InputEvent) => {
      if (!composing.current && !element.value && event.cancelable) {
        if (event.inputType === 'deleteContentBackward') { event.preventDefault(); input.key(SPECIAL_KEYS.Delete); }
        if (event.inputType === 'insertLineBreak') { event.preventDefault(); input.key(SPECIAL_KEYS.Return); }
      }
    };
    element.addEventListener('beforeinput', beforeInput);
    return () => { element.removeEventListener('beforeinput', beforeInput); if (timer.current) clearTimeout(timer.current); };
  }, [field, input]);
  useEffect(() => { if (!enabled && field.current) { composing.current = false; field.current.value = ''; field.current.blur(); } }, [enabled, field]);
  return <textarea ref={field} className="phone-keyboard-field" aria-label="Phone keyboard input" disabled={!enabled} rows={1} maxLength={4096}
    autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false}
    onInput={() => { if (composing.current) return; if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(commit, 120); }}
    onCompositionStart={() => { composing.current = true; if (timer.current) clearTimeout(timer.current); }}
    onCompositionEnd={() => { composing.current = false; timer.current = setTimeout(commit, 120); }}
    onBlur={commit}
    onKeyDown={event => {
      if (composing.current || event.nativeEvent.isComposing || event.currentTarget.value) return;
      const arrows: Record<string, number> = { ArrowLeft: SPECIAL_KEYS.Left, ArrowRight: SPECIAL_KEYS.Right, ArrowUp: SPECIAL_KEYS.Up, ArrowDown: SPECIAL_KEYS.Down, Escape: SPECIAL_KEYS.Escape, Tab: SPECIAL_KEYS.Tab };
      if (arrows[event.key] === undefined) return;
      event.preventDefault();
      input.key(arrows[event.key], [event.shiftKey && 'shift', event.metaKey && 'cmd', event.ctrlKey && 'ctrl', event.altKey && 'alt'].filter(Boolean) as Modifier[]);
    }} />;
}

export function RemoteKeyboard({ input, enabled }: { input: RemoteInput; enabled: boolean }) {
  const { hotkeys } = usePreferences();
  const [layer, setLayer] = useState<Layer>('letters');
  const [mods, setMods] = useState<Modifier[]>([]);
  const [capsLock, setCapsLock] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const lastShift = useRef(0);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (!enabled) { setMods([]); setCapsLock(false); } }, [enabled]);

  const shift = capsLock || mods.includes('shift');
  const chording = mods.some(mod => mod !== 'shift');
  const clearOneShot = () => setMods([]);

  function pressChar(char: string) {
    const out = layer === 'letters' && shift ? char.toUpperCase() : char;
    if (chording) {
      const chord = chordFor(out);
      if (chord) input.key(chord.code, [...new Set<Modifier>([...mods, ...(chord.shift ? ['shift' as const] : [])])]);
    } else input.type(out);
    clearOneShot();
  }
  function pressKey(code: number) { input.key(code, mods); clearOneShot(); }
  function toggleMod(mod: Modifier) {
    if (mod === 'shift') {
      const now = Date.now();
      if (capsLock) { setCapsLock(false); setMods(value => value.filter(item => item !== 'shift')); return; }
      if (mods.includes('shift') && now - lastShift.current < 320) { setCapsLock(true); return; }
      lastShift.current = now;
    }
    setMods(value => value.includes(mod) ? value.filter(item => item !== mod) : [...value, mod]);
  }

  const rows = LAYERS[layer];
  const glyph = (char: string) => layer === 'letters' && shift ? char.toUpperCase() : char;
  const modKey = (mod: Modifier) => <Key key={mod} label={MODIFIER_NAME[mod]} pressed={mods.includes(mod)} disabled={!enabled} className="kb-mod" onPress={() => toggleMod(mod)}>{MODIFIER_SYMBOL[mod]}</Key>;

  return <div className="remote-keyboard" role="group" aria-label={shortcuts ? 'Shortcuts' : 'Keyboard'}>
    <PhoneKeyboardField input={input} enabled={enabled} field={field} />
    <div className="kb-row kb-utility">
      <Key label="esc" disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Escape)}>esc</Key>
      <Key label="Tab" disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Tab)}>⇥</Key>
      <Key label="Left arrow key" repeat disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Left)}><ArrowLeft size={15} aria-hidden="true" /></Key>
      <Key label="Up arrow key" repeat disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Up)}><ArrowUp size={15} aria-hidden="true" /></Key>
      <Key label="Down arrow key" repeat disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Down)}><ArrowDown size={15} aria-hidden="true" /></Key>
      <Key label="Right arrow key" repeat disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Right)}><ArrowRight size={15} aria-hidden="true" /></Key>
      <Key label={shortcuts ? 'Show keyboard' : 'Show shortcuts'} pressed={shortcuts} className="kb-fn" onPress={() => setShortcuts(value => !value)}>{shortcuts ? <Keyboard size={16} aria-hidden="true" /> : <Zap size={15} aria-hidden="true" />}</Key>
      <Key label="Phone keyboard" disabled={!enabled} className="kb-fn" onPress={() => field.current?.focus()}><Smartphone size={15} aria-hidden="true" /></Key>
    </div>
    {shortcuts ? <div className="kb-shortcuts">
      {hotkeys.map(item => {
        const code = keyCode(item.key);
        // The visible label and combination form the name (⌘ is read as "command").
        return <button type="button" key={item.id} className="kb-shortcut" disabled={!enabled || code === null} title={hotkeySpoken(item)} onClick={() => code !== null && input.key(code, item.modifiers)}>
          <span className="truncate">{item.label}</span> <kbd>{hotkeyCombo(item)}</kbd>
        </button>;
      })}
      {!hotkeys.length && <p className="col-span-full self-center text-center text-xs text-muted-foreground">No shortcuts</p>}
    </div> : <>
      <div className="kb-row">
        {rows[0].map(char => <Key key={char} label={glyph(char)} disabled={!enabled} onPress={() => pressChar(char)}>{glyph(char)}</Key>)}
        <Key label="Delete" wide={1.4} repeat disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Delete)}><Delete size={16} aria-hidden="true" /></Key>
      </div>
      <div className="kb-row">
        {rows[1].map(char => <Key key={char} label={glyph(char)} disabled={!enabled} onPress={() => pressChar(char)}>{glyph(char)}</Key>)}
        <Key label="Return" wide={2} disabled={!enabled} className="kb-fn" onPress={() => pressKey(SPECIAL_KEYS.Return)}>↩</Key>
      </div>
      <div className="kb-row">
        {layer === 'letters'
          ? <Key label={capsLock ? 'Caps lock' : 'Shift'} wide={1.4} pressed={shift} disabled={!enabled} className="kb-mod" onPress={() => toggleMod('shift')}><ArrowBigUp size={17} aria-hidden="true" fill={capsLock ? 'currentColor' : 'none'} /></Key>
          : <Key label={layer === 'numbers' ? '#+=' : '123'} wide={1.4} disabled={!enabled} className="kb-fn" onPress={() => setLayer(layer === 'numbers' ? 'symbols' : 'numbers')}>{layer === 'numbers' ? '#+=' : '123'}</Key>}
        {rows[2].map(char => <Key key={char} label={glyph(char)} disabled={!enabled} onPress={() => pressChar(char)}>{glyph(char)}</Key>)}
      </div>
      <div className="kb-row">
        <Key label={layer === 'letters' ? '123' : 'ABC'} wide={1.4} disabled={!enabled} className="kb-fn" onPress={() => setLayer(layer === 'letters' ? 'numbers' : 'letters')}>{layer === 'letters' ? '123' : 'ABC'}</Key>
        {(['ctrl', 'alt', 'cmd'] as const).map(modKey)}
        <Key label="Space" wide={5} disabled={!enabled} onPress={() => chording ? pressKey(SPECIAL_KEYS.Space) : (input.type(' '), clearOneShot())}>{' '}</Key>
      </div>
    </>}
  </div>;
}
