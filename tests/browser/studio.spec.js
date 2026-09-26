import { test, expect } from '@playwright/test';

for (const [device, width, height] of [['desktop',1440,1100],['mobile',390,844]]) {
  test(`${device}: real service generation, controls, export and sign-in dialog`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const errors=[]; page.on('pageerror', error=>errors.push(error.message));
    await page.goto('/');
    await expect(page.getByRole('heading',{name:'From intent to form.'})).toBeVisible();
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.getByLabel('Leg A',{exact:true}).fill('100');
    await expect(page.getByText('Unapplied changes')).toBeVisible();
    await expect(page.getByRole('button', {name:'Export 3D model'})).toBeDisabled();
    const response = page.waitForResponse(r=>r.url().includes('/api/conseiv/cad-mesh-generation') && r.request().method()==='POST');
    await page.getByRole('button',{name:'Generate geometry'}).click();
    const generated=await response; expect(generated.status()).toBe(200);
    expect((await generated.json()).parameters.legAWidth).toBe(100);
    await expect(page.getByRole('status')).toContainText('Geometry generated');
    await expect(page.getByRole('button', {name:'Export 3D model'})).toBeEnabled();
    await page.getByRole('button',{name:'Flat pattern',exact:true}).click();
    await expect(page.getByRole('button',{name:'Flat pattern',exact:true})).toHaveAttribute('aria-pressed','true');
    await page.getByRole('button',{name:'Wireframe',exact:true}).click();
    await page.getByRole('button',{name:'Wireframe',exact:true}).click();
    await page.getByLabel('Export format').selectOption('obj');
    const downloaded=page.waitForEvent('download');
    await page.getByRole('button',{name:'Export flat model'}).click();
    const download=await downloaded; expect(download.suggestedFilename()).toMatch(/-flat\.obj$/);
    const stream=await download.createReadStream(); let text=''; for await(const chunk of stream) text+=chunk;
    expect(text).toMatch(/^# Conseiv/); expect(text).toContain('\nv ');
    await page.getByRole('button',{name:'Save to library'}).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Email',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Close sign in'}).click();
    await page.getByLabel('Hole margin',{exact:true}).fill('1');
    await page.getByRole('button',{name:'Generate geometry'}).click();
    await expect(page.getByRole('alert')).toContainText('clear');
    await expect(page.getByRole('button', {name:'Export flat model'})).toBeDisabled();
    await page.getByLabel('Hole margin',{exact:true}).fill('12');
    await page.getByRole('button',{name:'Generate geometry'}).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.getByRole('button', {name:'Export flat model'})).toBeEnabled();
    await page.getByRole('button',{name:'Formed',exact:true}).click();
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`test-results/conseiv-${device}.png`,fullPage:true});
    expect(errors).toEqual([]);
  });
}
