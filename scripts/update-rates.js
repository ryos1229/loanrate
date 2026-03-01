import { chromium } from 'playwright';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import * as dotenv from 'dotenv';
dotenv.config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Firebase Admin 初期化
let firebaseInitialized = false;
function initFirebase() {
    if (firebaseInitialized) return;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Firebase環境変数が設定されていません。GitHub Secretsを確認してください。');
    }

    initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    firebaseInitialized = true;
}

// 汎用スクレイピング戦略（ページ内の最も低い0.3%〜1.5%の％数値を変動金利として扱う）
const genericVariableStrategy = async (page) => {
    try {
        await page.waitForTimeout(3000); // 動的描画を待機
        const text = await page.evaluate(() => document.body.innerText);
        const matches = text.match(/[\d０-９]+\.[\d０-９]+[％%]/g);
        if (matches) {
            const nums = matches.map(m => parseFloat(m.replace(/[％%]/, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))));
            const valid = nums.filter(n => n >= 0.3 && n <= 1.5);
            if (valid.length > 0) {
                return { variable: Math.min(...valid) };
            }
        }
    } catch (e) { console.warn(`解析エラー: ${e.message}`); }
    return null;
};

// =====================================
// 各銀行のURLとスクレイピング戦略
// =====================================
const BANK_URLS = {
    'PayPay銀行': 'https://www.paypay-bank.co.jp/mortgage/interest/index.html',
    '三井住友信託銀行': 'https://www.smtb.jp/personal/loan/house',
    'りそな銀行': 'https://www.resonabank.co.jp/kojin/loan_viewer.html',
    'SBI新生銀行（SBIハイパー預金開設者割り）': 'https://www.sbishinseibank.co.jp/retail/housing/interest/interest_rate_new/?intcid=housing_txt_21',
    '三菱UFJ銀行': 'https://www.bk.mufg.jp/kariru/jutaku/yuuguu/index.html',
    '住信SBIネット銀行': 'https://www.netbk.co.jp/contents/lineup/home-loan/web/kinri/',
    'auじぶん銀行（融資率80%超）': 'https://www.jibunbank.co.jp/products/homeloan/interest/',
    '横浜銀行': 'https://www.boy.co.jp/kojin/jutaku-loan/shinchiku/index.html',
    'みずほ銀行': 'https://www.mizuhobank.co.jp/loan_housing/housingloancost/index.html',
    'イオン銀行': 'https://www.aeonbank.co.jp/interest/loan/',
    '中央労金（組合員）': 'https://chuo.rokin.com/banking/loan/housing/beginner/secured/',
    '中央労金（生協会員）': 'https://chuo.rokin.com/banking/loan/housing/beginner/secured/',
    '静岡銀行': 'https://www.shizuokabank.co.jp/personal/loan/jyutaku/index.html',
    '三井住友銀行': 'https://www.smbc.co.jp/kojin/kinri/loan.html',
    '中南信用金庫': 'https://www.shinkin.co.jp/chunan/_kinri/',
    'JAさがみ（給振優遇金利）': 'https://ja-sagami.or.jp/service/loan/fee/',
    '平塚信用金庫': 'https://www.shinkin.co.jp/hiratuka/individual/loan/housing/',
    'ARUHIフラット35': 'https://www.sbiaruhi.co.jp/rate/'
};

async function updateRates() {
    console.log('🚀 金利自動更新を開始します...');

    // 既存データを読み込む（フォールバック用）
    const existingData = JSON.parse(readFileSync(join(__dirname, '../src/data/rates.json'), 'utf8'));
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ locale: 'ja-JP' });

    let updatedCount = 0;
    const finalData = [];

    // 既存データをベースに回す
    for (const bank of existingData) {
        let currentBankData = { ...bank };
        const newUrl = BANK_URLS[bank.name];

        if (newUrl) {
            currentBankData.url = newUrl; // URLを一斉更新
            console.log(`\n🔍 ${bank.name} をチェック中... (${newUrl})`);
            const page = await context.newPage();
            try {
                await page.goto(newUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
                const newRates = await genericVariableStrategy(page);

                if (newRates && newRates.variable) {
                    currentBankData.variable = newRates.variable;
                    currentBankData.lastUpdate = new Date().toISOString();
                    console.log(`  ✅ 取得成功: 変動 ${newRates.variable}%`);
                    updatedCount++;
                } else {
                    console.log(`  ℹ️ 金利の自動抽出スキップ（既存データを維持）`);
                }
            } catch (error) {
                console.error(`  ❌ 取得失敗: ${error.message} (既存データを維持)`);
            } finally {
                await page.close();
            }
        } else {
            console.log(`\n⏭️ ${bank.name} はURLマッピングがないため現状維持します。`);
        }
        finalData.push(currentBankData);
    }

    await browser.close();

    // Firestore書き込み
    console.log('\n📤 Firestoreへ書き込み中...');
    initFirebase();
    const db = getFirestore();
    await db.collection('rates').doc('current').set({
        banks: finalData,
        lastUpdated: new Date().toISOString(),
        source: 'github-actions',
        updatedBanks: updatedCount,
    });

    console.log(`\n✅ 完了！Firestoreを更新しました。`);
    process.exit(0);
}

updateRates().catch(console.error);
