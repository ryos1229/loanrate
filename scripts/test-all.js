import { chromium } from 'playwright';

const urls = [
    "https://www.paypay-bank.co.jp/mortgage/interest/index.html",
    "https://www.smtb.jp/personal/loan/house",
    "https://www.resonabank.co.jp/kojin/loan_viewer.html",
    "https://www.sbishinseibank.co.jp/retail/housing/interest/interest_rate_new/?intcid=housing_txt_21",
    "https://www.bk.mufg.jp/kariru/jutaku/yuuguu/index.html",
    "https://www.netbk.co.jp/contents/lineup/home-loan/web/kinri/",
    "https://www.jibunbank.co.jp/products/homeloan/interest/",
    "https://www.boy.co.jp/kojin/jutaku-loan/shinchiku/index.html",
    "https://www.mizuhobank.co.jp/loan_housing/housingloancost/index.html",
    "https://www.aeonbank.co.jp/interest/loan/",
    "https://chuo.rokin.com/banking/loan/housing/beginner/secured/",
    "https://www.shizuokabank.co.jp/personal/loan/jyutaku/index.html",
    "https://www.smbc.co.jp/kojin/kinri/loan.html",
    "https://www.shinkin.co.jp/chunan/_kinri/",
    "https://ja-sagami.or.jp/service/loan/fee/",
    "https://www.shinkin.co.jp/hiratuka/individual/loan/housing/",
    "https://www.sbiaruhi.co.jp/rate/"
];

async function checkAll() {
    console.log("Starting tests...");
    const browser = await chromium.launch({ headless: true });

    for (const url of urls) {
        const page = await browser.newPage();
        try {
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
            await page.waitForTimeout(1000); // 描画待機
            const text = await page.evaluate(() => document.body.innerText);
            const matches = text.match(/[\d０-９]+\.[\d０-９]+[％%]/g) || [];

            const nums = matches.map(m => parseFloat(m.replace(/[％%]/, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))));
            const validVariables = nums.filter(n => n >= 0.2 && n <= 1.5);

            console.log(`\nURL: ${url}`);
            console.log(`抽出された金利候補 (0.2~1.5%):`, [...new Set(validVariables)].sort());
        } catch (e) {
            console.error(`Error on ${url}: ${e.message}`);
        } finally {
            await page.close();
        }
    }
    await browser.close();
}
checkAll();
