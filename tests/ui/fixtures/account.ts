import { expect, type Page } from '@playwright/test';

export async function login(page: Page, email: string, register = false) {
  await page.goto('/');
  {
    await page.getByRole('button', { name: 'Advanced connection settings' }).click();
    await page.getByLabel('Account server URL').fill('http://127.0.0.1:3000');
  }
  if (register) await page.getByRole('button', { name: 'Create an account', exact: true }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('browser-test-password-123');
  await page.getByRole('button', { name: register ? 'Create account' : 'Sign in', exact: true }).click();
  await expect(page.getByText('Signed in', { exact: true })).toBeVisible();
}
