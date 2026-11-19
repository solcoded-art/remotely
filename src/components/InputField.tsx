import { useId, type ComponentProps } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function InputField({ label, hint, error, id, ...props }: ComponentProps<typeof Input> & { label: string; hint?: string; error?: string }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  const description = [props['aria-describedby'], hint && `${fieldId}-hint`, error && `${fieldId}-error`].filter(Boolean).join(' ') || undefined;
  return <div className="field">
    <Label htmlFor={fieldId}>{label}</Label>
    <Input {...props} id={fieldId} aria-describedby={description} aria-invalid={error ? true : props['aria-invalid']} />
    {hint && <p id={`${fieldId}-hint`} className="field-hint">{hint}</p>}
    {error && <p id={`${fieldId}-error`} className="text-sm text-destructive">{error}</p>}
  </div>;
}
