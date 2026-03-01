/**
 * scripts/update-rates.js
 *
 * GitHub Actionsから毎月1〜3日に実行される金利自動更新スクリプト
 * 【改良版】キーワード文脈認識エンジンで精度を大幅向上
 */

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

    if (projectId && clientEmail && privateKey) {
        // GitHub Actions環境: 環境変数（Secrets）から読み込む
        initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) });
    } else {
        // ローカル環境: serviceAccountKey.json から読み込む
        console.log('  ℹ️ 環境変数なし → serviceAccountKey.jsonを使用します');
        const keyPath = join(__dirname, '../serviceAccountKey.json');
        const serviceAccount = JSON.parse(readFileSync(keyPath, 'utf8'));
        initializeApp({ credential: cert(serviceAccount) });
    }
    firebaseInitialized = true;
}

// =====================================
// 共通ユーティリティ
// =====================================

/** テキストから%数値を抽出してフィルタ */
function extractRates(text, minVal = 0.2, maxVal = 1.5) {
    const matches = text.match(/[\d０-９]+\.[\d０-９]+\s*[%％]/g) || [];
    return matches
        .map(m => parseFloat(m.replace(/[％%\s]/g, '').replace(/[０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0))))
        .filter(n => !isNaN(n) && n >= minVal && n <= maxVal);
}

/**
 * 文脈認識型の変動金利抽出
 * 「変動」「変動金利」などのキーワード周辺の行だけを対象に%を抽出する
 */
function extractVariableRateContextual(fullText, minVal = 0.2, maxVal = 1.5) {
    const lines = fullText.split(/\n/);
    const contextLines = [];

    // 変動金利キーワードが含まれる行を起点に前後5行をピックアップ
    for (let i = 0; i < lines.length; i++) {
        if (/変動/.test(lines[i])) {
            for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 6); j++) {
                contextLines.push(lines[j]);
            }
        }
    }

    const candidates = extractRates(contextLines.join('\n'), minVal, maxVal);
    return candidates.length > 0 ? Math.min(...candidates) : null;
}

/**
 * ページ内の特定セクション（startKeyword〜endKeyword）を切り出して抽出
 */
function extractSectionRate(fullText, startKeyword, endKeyword = null, minVal = 0.2, maxVal = 1.5) {
    const startIdx = fullText.indexOf(startKeyword);
    if (startIdx === -1) return null;
    const endIdx = endKeyword ? fullText.indexOf(endKeyword, startIdx + startKeyword.length) : -1;
    const sectionText = endIdx > -1
        ? fullText.slice(startIdx, endIdx)
        : fullText.slice(startIdx, startIdx + 4000);
    return extractVariableRateContextual(sectionText, minVal, maxVal);
}

/** ページのテキストを取得してキャッシュ */
async function getPageText(page, url, waitMs = 2000) {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp?.status()}: ${url}`);
    await page.waitForTimeout(waitMs);
    return page.evaluate(() => document.body.innerText);
}

// =====================================
// 銀行別スクレイピング設定
// =====================================
const BANK_CONFIGS = [
    {
        // 組合員・生協会員の両方を同一ページから取得するため特殊処理
        name: ['中央労金（組合員）', '中央労金（生協会員）'],
        url: 'https://chuo.rokin.com/banking/rate/secured/',  // 金利一覧項目別ページ
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 5000); // JS描画を十分待機
            // 「団体会員」セクション → 「生協会員」セクションの手前まで
            const kumiai = extractSectionRate(text, '団体会員', '生協会員');
            // 「生協会員」セクション → 「一般勤労者」セクションの手前まで
            const seikyou = extractSectionRate(text, '生協会員', '一般勤労者');
            console.log(`  → 中央労金 組合員: ${kumiai}%  生協会員: ${seikyou}%`);
            return {
                '中央労金（組合員）': kumiai ? { variable: kumiai } : null,
                '中央労金（生協会員）': seikyou ? { variable: seikyou } : null,
            };
        },
    },
    {
        name: 'PayPay銀行',
        url: 'https://www.paypay-bank.co.jp/mortgage/interest/index.html',
        strategy: async (page, url) => {
            const text = await getPageText(page, url);
            const rate = extractVariableRateContextual(text);
            console.log(`  → PayPay 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '三菱UFJ銀行',
        url: 'https://www.bk.mufg.jp/kariru/jutaku/yuuguu/index.html',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 3000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 三菱UFJ 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '三井住友銀行',
        url: 'https://www.smbc.co.jp/kojin/kinri/loan.html',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 三井住友 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: 'みずほ銀行',
        url: 'https://www.mizuhobank.co.jp/loan_housing/housingloancost/index.html',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → みずほ 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: 'りそな銀行',
        url: 'https://www.resonabank.co.jp/kojin/loan_viewer.html',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 3000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → りそな 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '三井住友信託銀行',
        url: 'https://www.smtb.jp/personal/loan/house',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 3000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 三井住友信託 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '横浜銀行',
        url: 'https://www.boy.co.jp/kojin/jutaku-loan/shinchiku/index.html',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 横浜銀行 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '静岡銀行',
        url: 'https://www.shizuokabank.co.jp/interest/loan.html',  // 金利一覧ページに変更
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 3000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 静岡銀行 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '住信SBIネット銀行',
        url: 'https://www.netbk.co.jp/contents/lineup/home-loan/web/kinri/',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 3000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 住信SBI 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: 'SBI新生銀行（SBIハイパー預金開設者割り）',
        url: 'https://www.sbishinseibank.co.jp/retail/housing/interest/interest_rate_new/',
        strategy: async (page, url) => {
            try {
                // HTTP/1.1強制でHTTP2プロトコルエラーを回避
                const resp = await page.goto(url, {
                    waitUntil: 'domcontentloaded',
                    timeout: 30000,
                });
                if (!resp || resp.status() >= 400) throw new Error(`HTTP ${resp?.status()}`);
                await page.waitForTimeout(3000);
                const text = await page.evaluate(() => document.body.innerText);
                // SBI新生は「SBIハイパー」近傈の最小値を採用
                const lines = text.split(/\n/);
                const contextLines = [];
                for (let i = 0; i < lines.length; i++) {
                    if (/ハイパー|変動/.test(lines[i])) {
                        for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 8); j++) {
                            contextLines.push(lines[j]);
                        }
                    }
                }
                const candidates = extractRates(contextLines.join('\n'), 0.3, 1.5);
                const rate = candidates.length > 0 ? Math.min(...candidates) : null;
                console.log(`  → SBI新生 変動: ${rate}%`);
                return rate ? { variable: rate } : null;
            } catch (e) {
                console.error(`  ❌ SBI新生 エラー: ${e.message}`);
                return null;
            }
        },
    },
    {
        name: 'auじぶん銀行（融資率80%超）',
        url: 'https://www.jibunbank.co.jp/products/homeloan/interest/',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 3000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → auじぶん銀行 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: 'イオン銀行',
        url: 'https://www.aeonbank.co.jp/interest/loan/',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → イオン銀行 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: 'JAさがみ（給振優遇金利）',
        url: 'https://ja-sagami.or.jp/service/loan/fee/',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → JAさがみ 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '中南信用金庫',
        url: 'https://www.shinkin.co.jp/chunan/_kinri/',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 中南信金 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: '平塚信用金庫',
        url: 'https://www.shinkin.co.jp/hiratuka/individual/loan/housing/',
        strategy: async (page, url) => {
            const text = await getPageText(page, url, 2000);
            const rate = extractVariableRateContextual(text);
            console.log(`  → 平塚信金 変動: ${rate}%`);
            return rate ? { variable: rate } : null;
        },
    },
    {
        name: 'ARUHIフラット35',
        url: 'https://www.sbiaruhi.co.jp/rate/',
        strategy: async (page, url) => {
            // フラット35は変動なし・全期間固定のため allTerm を取得
            const text = await getPageText(page, url, 2000);
            const lines = text.split(/\n/);
            const contextLines = [];
            for (let i = 0; i < lines.length; i++) {
                if (/フラット35|全期/.test(lines[i])) {
                    for (let j = Math.max(0, i - 1); j <= Math.min(lines.length - 1, i + 6); j++) {
                        contextLines.push(lines[j]);
                    }
                }
            }
            const candidates = extractRates(contextLines.join('\n'), 1.5, 4.0);
            const rate = candidates.length > 0 ? Math.min(...candidates) : null;
            console.log(`  → ARUHIフラット35 全期間: ${rate}%`);
            return rate ? { allTerm: rate } : null;
        },
    },
];

// =====================================
// メイン処理
// =====================================
async function updateRates() {
    console.log('🚀 金利自動更新（改良版）を開始します...');
    console.log(`📅 実行日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

    const existingData = JSON.parse(readFileSync(join(__dirname, '../src/data/rates.json'), 'utf8'));
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    const context = await browser.newContext({ locale: 'ja-JP' });

    // 取得結果を蓄積するオブジェクト { 銀行名: 新しい率オブジェクト }
    const results = {};
    let updatedCount = 0;

    for (const config of BANK_CONFIGS) {
        const names = Array.isArray(config.name) ? config.name : [config.name];
        console.log(`\n🔍 ${names.join(' / ')} をチェック中...`);
        const page = await context.newPage();
        try {
            const rawResult = await config.strategy(page, config.url);

            if (rawResult && typeof rawResult === 'object' && !('variable' in rawResult) && !('allTerm' in rawResult)) {
                // 中央労金のように複数銀行を返す場合
                for (const [bankName, rates] of Object.entries(rawResult)) {
                    if (rates) { results[bankName] = { rates, url: config.url }; }
                }
            } else if (rawResult) {
                for (const bankName of names) {
                    results[bankName] = { rates: rawResult, url: config.url };
                }
            }
        } catch (error) {
            console.error(`  ❌ エラー: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // 既存データに取得結果をマージしてURLも更新
    const finalData = existingData.map(bank => {
        const hit = results[bank.name];
        if (hit) {
            updatedCount++;
            return { ...bank, ...hit.rates, url: hit.url, lastUpdate: new Date().toISOString() };
        }
        return bank;
    });

    // Firestoreに書き込む
    console.log('\n📤 Firestoreへ書き込み中...');
    initFirebase();
    const db = getFirestore();
    await db.collection('rates').doc('current').set({
        banks: finalData,
        lastUpdated: new Date().toISOString(),
        source: 'github-actions',
        updatedBanks: updatedCount,
    });

    console.log(`\n✅ 完了！${updatedCount}件の金利を更新、Firestoreに保存しました。`);
    process.exit(0);
}

updateRates().catch(err => {
    console.error('\n💥 エラー:', err);
    process.exit(1);
});
