/**
 * scripts/seed-firestore.js
 * 
 * 初回のみ実行：ローカルのrates.jsonをFirestoreに投入するスクリプト
 * 
 * 【実行方法】
 * 1. Firebase Consoleからサービスアカウントキーをダウンロード
 *    (プロジェクト設定 → サービスアカウント → 新しい秘密鍵の生成)
 * 2. ダウンロードしたJSONを serviceAccountKey.json として保存
 *    ※ このファイルは .gitignore に追加されているので安全です
 * 3. 実行: node scripts/seed-firestore.js
 */

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// サービスアカウントキーを読み込む
const serviceAccount = JSON.parse(
    readFileSync(join(__dirname, '../serviceAccountKey.json'), 'utf8')
);

// Firebase Admin SDK初期化
initializeApp({
    credential: cert(serviceAccount),
});

const db = getFirestore();

async function seedFirestore() {
    console.log('🌱 Firestoreへの初期データ投入を開始します...');

    // ローカルのrates.jsonを読み込む
    const banksData = JSON.parse(
        readFileSync(join(__dirname, '../src/data/rates.json'), 'utf8')
    );

    const docRef = db.collection('rates').doc('current');
    await docRef.set({
        banks: banksData,
        lastUpdated: new Date().toISOString(),
        source: 'seed-script',
    });

    console.log(`✅ 完了！${banksData.length}件の銀行データをFirestoreに保存しました。`);
    console.log('📊 コレクション: rates');
    console.log('📄 ドキュメント: current');
    process.exit(0);
}

seedFirestore().catch((err) => {
    console.error('❌ エラーが発生しました:', err);
    process.exit(1);
});
