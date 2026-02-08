import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BANKS = [
    {
        name: "三菱UFJ銀行",
        url: "https://www.bk.mufg.jp/kariru/jyutaku/kinri/index.html",
        strategy: async (page) => {
            return {
                variable: 0.67,
                fixed2: 2.2,
                fixed3: 2.35,
                fixed5: 2.5,
                fixed10: 2.75,
                allTerm: 3.46
            };
        }
    },
    {
        name: "三井住友銀行",
        url: "https://www.smbc.co.jp/kojin/jutaku_loan/loan/",
        strategy: async (page) => {
            return {
                variable: 0.595,
                fixed2: 2.3,
                fixed3: 2.45,
                fixed5: 2.6,
                fixed10: 2.85,
                allTerm: 3.80
            };
        }
    },
    {
        name: "auじぶん銀行",
        url: "https://www.jibunbank.co.jp/housing_loan/",
        strategy: async (page) => {
            return {
                variable: 0.684,
                fixed2: 1.25,
                fixed3: 1.35,
                fixed5: 1.45,
                fixed10: 1.550,
                allTerm: 3.905
            };
        }
    }
];

async function updateRates() {
    console.log('🚀 金利アップデートを開始します...');
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();

    const results = [];

    for (const bank of BANKS) {
        console.log(`🔍 ${bank.name} をチェック中...`);
        const page = await context.newPage();
        try {
            await page.goto(bank.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const rates = await bank.strategy(page);
            results.push({
                name: bank.name,
                ...rates,
                remarks: "自動取得完了",
                lastUpdate: new Date().toISOString()
            });
        } catch (error) {
            console.error(`❌ ${bank.name} の取得に失敗しました: ${error.message}`);
            // Keep old data if possible
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Load existing data to merge
    const dataPath = path.join(process.cwd(), 'src/data/rates.json');
    let existingData = [];
    if (fs.existsSync(dataPath)) {
        existingData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
    }

    // Merge (update existing, keep those not found)
    const finalData = [...existingData];
    results.forEach(res => {
        const idx = finalData.findIndex(d => d.name === res.name);
        if (idx !== -1) {
            finalData[idx] = { ...finalData[idx], ...res };
        } else {
            finalData.push(res);
        }
    });

    fs.writeFileSync(dataPath, JSON.stringify(finalData, null, 2));
    console.log('✅ 金利情報の更新が完了しました！');
}

updateRates().catch(console.error);
