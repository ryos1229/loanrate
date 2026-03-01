import { chromium } from 'playwright';

async function findUrl() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
        await page.goto('https://kakaku.com/housing-loan/list/?houseType=1');
        const links = await page.$$eval('a', els => els.map(el => el.href).filter(h => h.includes('paypay')));
        console.log("Kakaku Links:", [...new Set(links)]);
    } catch (e) {
        console.error(e);
    }
    await browser.close();
}
findUrl();
