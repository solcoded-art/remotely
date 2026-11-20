import { useId, useState } from 'react';
import { Loader2, LogOut, Plus, RotateCcw, Settings2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogClose, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { request } from '@/lib/api';
import { hotkeyCombo, hotkeySpoken, MODIFIER_NAME, MODIFIER_SYMBOL, MODIFIERS, SPECIAL_KEYS, type Modifier } from '@/lib/keymap';
import { preferences, SPEED_RANGE, usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import type { Auth } from '@/lib/types';

const CHAR_KEYS = [...'abcdefghijklmnopqrstuvwxyz0123456789', '-', '=', '[', ']', ';', "'", ',', '.', '/', '\\', '`'];
const NAMED_KEYS = Object.keys(SPECIAL_KEYS);

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  const id = useId();
  return <section aria-labelledby={id} className="grid gap-3 border-t border-border pt-4 first:border-0 first:pt-0">
    <div className="flex items-center justify-between gap-2"><h3 id={id} className="text-sm font-semibold">{title}</h3>{action}</div>
    {children}
  </section>;
}

function HotkeyEditor() {
  const { hotkeys } = usePreferences();
  const [label, setLabel] = useState(''); const [key, setKey] = useState('a'); const [mods, setMods] = useState<Modifier[]>(['cmd']);
  const [error, setError] = useState('');
  const draft = { key, modifiers: mods };
  return <>
    <ul className="grid gap-1" aria-label="Shortcuts">
      {hotkeys.map(item => <li key={item.id} className="flex min-h-10 items-center gap-2 rounded-md px-2 hover:bg-muted/40">
        <span className="min-w-0 flex-1 truncate text-sm">{item.label}</span>
        <kbd className="hotkey-combo" aria-label={hotkeySpoken(item)}>{hotkeyCombo(item)}</kbd>
        <Button type="button" variant="ghost" size="icon" className="size-8" aria-label={`Remove ${item.label}`} onClick={() => preferences.removeHotkey(item.id)}><X size={14} /></Button>
      </li>)}
      {!hotkeys.length && <li className="px-2 text-sm text-muted-foreground">No shortcuts</li>}
    </ul>
    <form className="grid gap-2 rounded-lg border border-border p-3" aria-label="Add shortcut" onSubmit={event => {
      event.preventDefault();
      if (!label.trim()) { setError('Name the shortcut.'); return; }
      if (hotkeys.some(item => item.key === key && item.modifiers.length === mods.length && item.modifiers.every(mod => mods.includes(mod)))) { setError(`${hotkeyCombo(draft)} is already a shortcut.`); return; }
      if (!preferences.addHotkey({ label, key, modifiers: MODIFIERS.filter(mod => mods.includes(mod)) })) { setError('That shortcut is not supported.'); return; }
      setLabel(''); setError('');
    }}>
      <Input aria-label="Shortcut name" placeholder="Name" maxLength={40} value={label} onChange={event => { setLabel(event.target.value); setError(''); }} />
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex gap-1" role="group" aria-label="Modifiers">
          {MODIFIERS.map(mod => <button key={mod} type="button" aria-label={MODIFIER_NAME[mod]} aria-pressed={mods.includes(mod)} className={cn('hotkey-mod', mods.includes(mod) && 'is-on')}
            onClick={() => { setError(''); setMods(value => value.includes(mod) ? value.filter(item => item !== mod) : [...value, mod]); }}>{MODIFIER_SYMBOL[mod]}</button>)}
        </div>
        <select aria-label="Key" className="h-9 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm" value={key} onChange={event => { setKey(event.target.value); setError(''); }}>
          <optgroup label="Keys">{CHAR_KEYS.map(char => <option key={char} value={char}>{char.toUpperCase()}</option>)}</optgroup>
          <optgroup label="Special">{NAMED_KEYS.map(name => <option key={name} value={name}>{name}</option>)}</optgroup>
        </select>
        <kbd className="hotkey-combo" aria-hidden="true">{hotkeyCombo(draft)}</kbd>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <Button type="submit" variant="outline" size="sm"><Plus size={14} />Add shortcut</Button>
    </form>
  </>;
}

export function SettingsDialog({ auth, logout }: { auth: Auth; logout(): void }) {
  const { trackpadSpeed } = usePreferences();
  const [confirmEmail, setConfirmEmail] = useState(''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [confirmDelete, setConfirmDelete] = useState(false);
  return <Dialog onOpenChange={() => { setConfirmEmail(''); setError(''); setConfirmDelete(false); }}>
    <DialogTrigger asChild><Button variant="ghost" size="icon" aria-label="Settings"><Settings2 size={17} /></Button></DialogTrigger>
    <DialogContent aria-describedby={undefined} className="gap-5">
      <DialogHeader><DialogTitle>Settings</DialogTitle></DialogHeader>
      <Section title="Account">
        <div className="min-w-0"><p className="break-all text-sm">{auth.user.email}</p><p className="break-all text-xs text-muted-foreground">{auth.service}</p></div>
        <DialogClose asChild><Button variant="outline" onClick={logout}><LogOut />Sign out</Button></DialogClose>
      </Section>
      <Section title="Trackpad">
        <label className="flex items-center gap-3 text-sm">Speed
          <input aria-label="Trackpad speed" className="min-w-0 flex-1 accent-[var(--primary)]" type="range" min={SPEED_RANGE.min} max={SPEED_RANGE.max} step={SPEED_RANGE.step} value={trackpadSpeed} onChange={event => preferences.setTrackpadSpeed(Number(event.target.value))} />
          <output className="w-10 text-right tabular-nums text-muted-foreground">{trackpadSpeed.toFixed(1)}×</output>
        </label>
      </Section>
      <Section title="Shortcuts" action={<Button type="button" variant="ghost" size="sm" onClick={preferences.resetHotkeys}><RotateCcw size={14} />Reset</Button>}>
        <HotkeyEditor />
      </Section>
      <Section title="Danger zone">
        {!confirmDelete ? <Button variant="ghost" className="justify-self-start text-destructive" onClick={() => setConfirmDelete(true)}>Delete account…</Button> : <form onSubmit={async event => {
          event.preventDefault(); setBusy(true); setError('');
          try { await request(auth.service, '/api/account', { token: auth.token, method: 'DELETE', data: { confirmEmail } }); logout(); }
          catch (error) { setError(error instanceof Error ? error.message : 'Deletion failed.'); } finally { setBusy(false); }
        }}><p className="mb-3 text-xs leading-6 text-muted-foreground">Permanently delete your account, login sessions, and paired devices. Sign in with a fresh email link (within five minutes), then enter your email to confirm.</p><Input aria-label="Confirm account email" type="email" autoComplete="email" required value={confirmEmail} onChange={event => setConfirmEmail(event.target.value)} />{error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}<Button variant="destructive" className="mt-3 w-full" disabled={busy}>{busy && <Loader2 className="animate-spin" />}Permanently delete account</Button></form>}
      </Section>
    </DialogContent>
  </Dialog>;
}
