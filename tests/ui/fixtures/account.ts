import { expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

async function mailbox(email: string): Promise<{ id: string; url: string } | null> {
  if (!process.env.TEST_MAILBOX_DIR) throw Error('Use the disposable PostgreSQL test runner.');
  try { return JSON.parse(await readFile(path.join(process.env.TEST_MAILBOX_DIR, createHash('sha256').update(email).digest('hex') + '.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function login(page: Page, email: string, options: { navigate?: boolean } = {}) {
  if (options.navigate !== false) await page.goto('/login');
  await page.getByRole('button', { name: 'Advanced connection settings' }).click();
  await page.getByLabel('Account server URL').fill('http://127.0.0.1:3000');
  await page.getByLabel('Email address').fill(email);
  const previous = (await mailbox(email))?.id;
  await page.getByRole('button', { name: 'Send sign-in link', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Check your inbox' })).toBeVisible();
  await expect.poll(async () => { const mail = await mailbox(email); return !!mail && mail.id !== previous; }).toBe(true);
  const mail = await mailbox(email);
  await page.getByRole('button', { name: 'Paste a sign-in link', exact: true }).click();
  await page.getByLabel('Email sign-in link', { exact: true }).fill(mail!.url);
  await page.getByRole('button', { name: 'Continue with email link', exact: true }).click();
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
}
