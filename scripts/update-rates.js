/**
 * scripts/update-rates.js
 *
 * GitHub Actionsから毎月1日に実行される金利自動更新スクリプト
 * Playwright でスクレイピングし、Firebase Admin SDK で Firestore に書き込む
 *
 * 環境変数（GitHub Secrets）:
 *   FIREBASE_PROJECT_ID  - FirebaseプロジェクトID
 *   FIREBASE_CLIENT_EMAIL - サービスアカウントのメールアドレス
 *   FIREBASE_PRIVATE_KEY  - サービスアカウントの秘密鍵（改行を\nで）
 */

import { chromium } from 'playwright';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Firebase Admin 初期化（GitHub Actions環境）
let firebaseInitialized = false;
function initFirebase() {
    if (firebaseInitialized) return;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('Firebase環境変数が設定されていません。GitHub Secretsを確認してください。');
    }

    initializeApp({
        credential: cert({ projectId, clientEmail, privateKey }),
    });
    firebaseInitialized = true;
}

// =====================================
// 各銀行のスクレイピング戦略
// =====================================
const BANKS = [
    {
        name: '三菱UFJ銀行',
        url: 'https://www.bk.mufg.jp/',
        infoUrl: 'https://www.bk.mufg.jp/',
        strategy: async (page) => {
            // 三菱UFJは動的ページのため、スクレイピングが難しいため手動更新用の固定値を維持
            // 実際の値は公式サイト（https://www.bk.mufg.jp/kariru/jyutaku/kinri/index.html）を確認
            const currentData = JSON.parse(readFileSync(join(__dirname, '../src/data/rates.json'), 'utf8'));
            const existing = currentData.find(b => b.name === '三菱UFJ銀行');
            return existing ? {
                variable: existing.variable,
                baseRateVariable: existing.baseRateVariable,
                fixed2: existing.fixed2,
                fixed3: existing.fixed3,
                fixed5: existing.fixed5,
                fixed10: existing.fixed10,
                allTerm: existing.allTerm,
                url: existing.url,
                remarks: existing.remarks,
            } : null;
        },
    },
    {
        name: 'PayPay銀行',
        url: 'https://www.paypay-bank.co.jp/service/loan/housing/',
        infoUrl: 'https://www.paypay-bank.co.jp/service/loan/housing/',
        strategy: async (page) => {
            try {
                await page.waitForSelector('body', { timeout: 15000 });
                const content = await page.content();
                // ページ内から変動金利を探す（数値パターン: 0.xx%）
                const matches = content.match(/(\d+\.\d+)%/g);
                if (matches && matches.length > 0) {
                    // 0.3〜1.5の範囲内の数値を変動金利候補とする
                    const candidates = matches
                        .map(m => parseFloat(m))
                        .filter(v => v >= 0.3 && v <= 1.5);
                    if (candidates.length > 0) {
                        const variable = Math.min(...candidates);
                        console.log(`  → PayPay銀行 変動金利候補: ${candidates.join(', ')}% → ${variable}%を採用`);
                        return { variable };
                    }
                }
            } catch (e) {
                console.warn(`  PayPay銀行 スクレイピング失敗: ${e.message}`);
            }
            return null; // フォールバック: 既存データを維持
        },
    },
    {
        name: 'auじぶん銀行（融資率80%超）',
        url: 'https://www.jibunbank.co.jp/lp/housing-loan/202502/',
        infoUrl: 'https://www.jibunbank.co.jp/lp/housing-loan/',
        strategy: async (page) => {
            try {
                await page.waitForSelector('body', { timeout: 15000 });
                const content = await page.content();
                const matches = content.match(/(\d+\.\d+)%/g);
                if (matches) {
                    const candidates = matches
                        .map(m => parseFloat(m))
                        .filter(v => v >= 0.3 && v <= 1.5);
                    if (candidates.length > 0) {
                        const variable = Math.min(...candidates);
                        console.log(`  → auじぶん銀行 変動金利候補: ${candidates.join(', ')}% → ${variable}%を採用`);
                        return { variable };
                    }
                }
            } catch (e) {
                console.warn(`  auじぶん銀行 スクレイピング失敗: ${e.message}`);
            }
            return null;
        },
    },
    {
        name: '住信SBIネット銀行',
        url: 'https://www.netbk.co.jp/contents/lp/housing-loan/index.html',
        infoUrl: 'https://www.netbk.co.jp/',
        strategy: async (page) => {
            try {
                await page.waitForSelector('body', { timeout: 15000 });
                const content = await page.content();
                const matches = content.match(/(\d+\.\d+)%/g);
                if (matches) {
                    const candidates = matches
                        .map(m => parseFloat(m))
                        .filter(v => v >= 0.3 && v <= 1.5);
                    if (candidates.length > 0) {
                        const variable = Math.min(...candidates);
                        console.log(`  → 住信SBI 変動金利候補: ${candidates.join(', ')}% → ${variable}%を採用`);
                        return { variable };
                    }
                }
            } catch (e) {
                console.warn(`  住信SBIネット銀行 スクレイピング失敗: ${e.message}`);
            }
            return null;
        },
    },
];

// =====================================
// メイン処理
// =====================================
async function updateRates() {
    console.log('🚀 金利自動更新を開始します...');
    console.log(`📅 実行日時: ${new Date().toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })}`);

    // 既存データを読み込む（フォールバック用）
    const existingData = JSON.parse(
        readFileSync(join(__dirname, '../src/data/rates.json'), 'utf8')
    );

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        locale: 'ja-JP',
    });

    const updatedData = [...existingData];
    let updatedCount = 0;

    for (const bank of BANKS) {
        console.log(`\n🔍 ${bank.name} をチェック中...`);
        const page = await context.newPage();
        try {
            await page.goto(bank.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
            const newRates = await bank.strategy(page);

            if (newRates) {
                const idx = updatedData.findIndex(d => d.name === bank.name);
                if (idx !== -1) {
                    const now = new Date().toISOString();
                    updatedData[idx] = {
                        ...updatedData[idx],
                        ...newRates,
                        lastUpdate: now,
                    };
                    updatedCount++;
                    console.log(`  ✅ ${bank.name} 更新完了`);
                } else {
                    console.log(`  ⚠️ ${bank.name} は既存データに見つかりませんでした。スキップします。`);
                }
            } else {
                console.log(`  ℹ️ ${bank.name} は既存データを維持します。`);
            }
        } catch (error) {
            console.error(`  ❌ ${bank.name} の処理に失敗: ${error.message}`);
        } finally {
            await page.close();
        }
    }

    await browser.close();

    // Firestoreに書き込む
    console.log('\n📤 Firestoreへ書き込み中...');
    initFirebase();
    const db = getFirestore();
    const docRef = db.collection('rates').doc('current');
    await docRef.set({
        banks: updatedData,
        lastUpdated: new Date().toISOString(),
        source: 'github-actions',
        updatedBanks: updatedCount,
    });

    console.log(`\n✅ 完了！${updatedCount}件の金利を更新し、Firestoreに保存しました。`);
    console.log(`📊 合計 ${updatedData.length} 件のデータを管理中`);
    process.exit(0);
}

updateRates().catch((err) => {
    console.error('\n💥 致命的なエラーが発生しました:', err);
    process.exit(1);
});
