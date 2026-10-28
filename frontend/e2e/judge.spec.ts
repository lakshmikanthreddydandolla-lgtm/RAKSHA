import { expect, test } from '@playwright/test'

test('judge can activate RAKSHA, enter Demo Model, create a named user and chat', async ({ page }) => {
  await page.goto('http://127.0.0.1:5174', { waitUntil: 'networkidle' })

  await expect(page.getByRole('heading', { name: 'RAKSHA' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ACTIVATE' })).toBeVisible()
  await expect(page.locator('body')).not.toContainText('[object Object]')

  await page.getByRole('button', { name: 'ACTIVATE' }).click()
  await page.waitForTimeout(1900)

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()
  const box = await canvas.boundingBox()
  expect(box).not.toBeNull()
  await canvas.click({ position: { x: box!.width / 2, y: box!.height / 2 } })

  const commandPlaque = page.getByRole('button', { name: 'COMMAND CENTER' })
  await expect(commandPlaque).toBeVisible({ timeout: 5000 })
  await commandPlaque.click()

  await expect(page.getByText('Select intelligence source')).toBeVisible({ timeout: 5000 })
  await page.getByRole('button', { name: /DEMO MODEL/ }).click()

  const nameInput = page.getByPlaceholder('Enter user name')
  await expect(nameInput).toBeVisible({ timeout: 5000 })
  await nameInput.fill('Judge Demo')
  await page.locator('.new-user-form button[type="submit"]').click()

  await expect(page.getByText('Judge Demo', { exact: true }).first()).toBeVisible({ timeout: 5000 })
  const chatInput = page.getByPlaceholder('Message the agent…')
  await expect(chatInput).toBeEnabled({ timeout: 5000 })
  await chatInput.fill('hello')
  await page.getByRole('button', { name: 'SEND' }).click()

  await expect(page.getByText(/RAKSHA Demo Agent online/i)).toBeVisible({ timeout: 8000 })
  await expect(page.locator('body')).not.toContainText('[object Object]')
})
