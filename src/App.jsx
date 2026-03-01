import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
    TrendingDown,
    RefreshCw,
    Search,
    Info,
    Landmark,
    ExternalLink,
    Table as TableIcon,
    Printer,
    FileDown,
    MoveHorizontal,
    CheckCircle,
    AlertCircle
} from 'lucide-react';
import { db } from './firebase.js';
import { doc, getDoc } from 'firebase/firestore';
import fallbackRates from './data/rates.json';

const RATE_TYPES = [
    { id: 'variable', label: '変動', fullLabel: '変動金利', color: 'emerald', hex: '#10b981', hexDark: '#059669' },
    { id: 'fixed2', label: '2年', fullLabel: '2年固定', color: 'cyan', hex: '#06b6d4', hexDark: '#0891b2' },
    { id: 'fixed3', label: '3年', fullLabel: '3年固定', color: 'sky', hex: '#0ea5e9', hexDark: '#0284c7' },
    { id: 'fixed5', label: '5年', fullLabel: '5年固定', color: 'indigo', hex: '#6366f1', hexDark: '#4f46e5' },
    { id: 'fixed10', label: '10年', fullLabel: '10年固定', color: 'blue', hex: '#3b82f6', hexDark: '#2563eb' },
    { id: 'allTerm', label: '全期間', fullLabel: '全期間固定', color: 'purple', hex: '#a855f7', hexDark: '#7e22ce' },
];

const App = () => {
    const [rates, setRates] = useState(fallbackRates);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('variable');
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateStatus, setUpdateStatus] = useState(null); // null | 'success' | 'error'
    const [isFirebaseReady, setIsFirebaseReady] = useState(false);

    const filteredRates = useMemo(() => {
        return rates
            .filter(bank => bank.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => {
                if (a[sortBy] === null) return 1;
                if (b[sortBy] === null) return -1;
                return a[sortBy] - b[sortBy];
            });
    }, [rates, searchTerm, sortBy]);

    const activeRateType = useMemo(() =>
        RATE_TYPES.find(t => t.id === sortBy) || RATE_TYPES[0]
        , [sortBy]);

    const lastCheckTime = useMemo(() => {
        const dates = rates.map(r => new Date(r.lastUpdate)).filter(d => !isNaN(d));
        if (dates.length === 0) return '不明';
        const latest = new Date(Math.max(...dates));
        return latest.toLocaleDateString('ja-JP', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    }, [rates]);

    // Firestoreから金利データを取得する関数
    const fetchRatesFromFirestore = useCallback(async () => {
        setIsUpdating(true);
        setUpdateStatus(null);
        try {
            const docRef = doc(db, 'rates', 'current');
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                const data = docSnap.data();
                if (data.banks && Array.isArray(data.banks)) {
                    setRates(data.banks);
                    setUpdateStatus('success');
                    setIsFirebaseReady(true);
                } else {
                    throw new Error('データ形式が不正です');
                }
            } else {
                // Firestoreにデータがまだない場合はフォールバック
                console.warn('Firestoreにデータが見つかりません。ローカルデータを使用します。');
                setRates(fallbackRates);
                setUpdateStatus('error');
            }
        } catch (error) {
            console.error('Firebase取得エラー:', error);
            // エラー時はローカルJSONにフォールバック
            setRates(fallbackRates);
            setUpdateStatus('error');
        } finally {
            setIsUpdating(false);
            // 3秒後にステータスをリセット
            setTimeout(() => setUpdateStatus(null), 3000);
        }
    }, []);

    // アプリ起動時に自動でFirestoreから取得
    useEffect(() => {
        fetchRatesFromFirestore();
    }, [fetchRatesFromFirestore]);

    const handleUpdate = () => {
        fetchRatesFromFirestore();
    };

    const StatCard = ({ title, value, unit, icon: Icon, color, subValue }) => (
        <div className="glass p-6 rounded-2xl float">
            <div className="flex justify-between items-start mb-4">
                <div className={`p-3 rounded-xl bg-${color}-500/20`}>
                    <Icon className={`w-6 h-6 text-${color}-400`} />
                </div>
            </div>
            <h3 className="text-slate-400 text-sm font-medium">{title}</h3>
            <div className="flex items-baseline gap-1 mt-1">
                <span className="text-3xl font-bold text-white">{value !== Infinity ? value : '-'}</span>
                <span className="text-slate-400 text-sm">{unit}</span>
            </div>
            {subValue && (
                <div className="mt-3 pt-3 border-t border-white/5">
                    <p className={`text-xs font-medium text-slate-300`}>{subValue}</p>
                </div>
            )}
        </div>
    );

    return (
        <div className="max-w-7xl mx-auto px-4 py-12">
            {/* Header */}
            <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6 mb-12">
                <div>
                    <h1 className="text-4xl md:text-5xl font-black mb-2 flex items-center gap-3">
                        <span className="text-gradient">住宅ローン金利</span>
                        <span className="text-white/20">|</span>
                        <span className="text-white text-3xl font-light">Dashboard</span>
                    </h1>
                    <p className="text-slate-400">主要金融機関の最新金利情報を一覧・比較</p>
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3 w-full md:w-auto">
                    <button
                        onClick={handleUpdate}
                        disabled={isUpdating}
                        className={`no-print glass-hover glass px-5 py-2.5 rounded-xl flex items-center gap-2 text-white text-sm font-semibold disabled:opacity-50 shadow-xl min-w-[160px] justify-center transition-all duration-300 ${updateStatus === 'success' ? 'border border-emerald-500/50 shadow-emerald-500/10' :
                                updateStatus === 'error' ? 'border border-rose-500/50 shadow-rose-500/10' :
                                    'shadow-blue-500/10'
                            }`}
                    >
                        {updateStatus === 'success' ? (
                            <CheckCircle className="w-4 h-4 text-emerald-400" />
                        ) : updateStatus === 'error' ? (
                            <AlertCircle className="w-4 h-4 text-rose-400" />
                        ) : (
                            <RefreshCw className={`w-4 h-4 ${isUpdating ? 'animate-spin' : ''}`} />
                        )}
                        {isUpdating ? '取得中...' :
                            updateStatus === 'success' ? '更新完了！' :
                                updateStatus === 'error' ? 'ローカルデータ使用中' :
                                    '最新情報を取得'}
                    </button>

                    <button
                        onClick={() => window.print()}
                        className="no-print glass-hover bg-slate-800/50 hover:bg-slate-700/50 border border-white/10 px-5 py-2.5 rounded-xl flex items-center gap-2 text-white text-sm font-semibold transition-all shadow-xl"
                    >
                        <Printer className="w-4 h-4 text-blue-400" />
                        A4印刷 / PDF
                    </button>

                    <div className="no-print flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider ml-2">
                        <span className={`w-1.5 h-1.5 rounded-full ${isFirebaseReady ? 'bg-emerald-500 animate-pulse' : 'bg-amber-400'
                            }`} />
                        <span className={isFirebaseReady ? 'text-emerald-400/70' : 'text-amber-400/70'}>
                            {isFirebaseReady ? 'Firebase同期済' : 'ローカルデータ'}
                        </span>
                        <span className="text-slate-600">|</span>
                        <span className="text-slate-500">更新: {lastCheckTime}</span>
                    </div>
                </div>
            </header>

            {/* Quick Stats */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <StatCard
                    title="変動金利 最安"
                    value={Math.min(...rates.map(r => r.variable).filter(v => v !== null))}
                    unit="%"
                    icon={TrendingDown}
                    color="emerald"
                    subValue={(() => {
                        const min = Math.min(...rates.map(r => r.variable).filter(v => v !== null));
                        return rates.filter(r => r.variable === min).map(r => r.name).join('、');
                    })()}
                />
                <StatCard
                    title="10年固定 最安"
                    value={Math.min(...rates.map(r => r.fixed10).filter(v => v !== null))}
                    unit="%"
                    icon={TrendingDown}
                    color="blue"
                    subValue={(() => {
                        const min = Math.min(...rates.map(r => r.fixed10).filter(v => v !== null));
                        return rates.filter(r => r.fixed10 === min).map(r => r.name).join('、');
                    })()}
                />
                <StatCard
                    title="全期間固定 最安"
                    value={Math.min(...rates.map(r => r.allTerm).filter(v => v !== null))}
                    unit="%"
                    icon={TrendingDown}
                    color="purple"
                    subValue={(() => {
                        const min = Math.min(...rates.map(r => r.allTerm).filter(v => v !== null));
                        return rates.filter(r => r.allTerm === min).map(r => r.name).join('、');
                    })()}
                />
            </div>

            {/* Controls Section */}
            <div className="no-print glass p-6 rounded-3xl mb-8 flex flex-col md:flex-row items-center gap-6 border border-white/5 shadow-xl">
                <div className="relative w-full md:w-72">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                        type="text"
                        placeholder="銀行名で検索..."
                        className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-blue-500/50 transition-all text-sm text-white"
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                    />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] text-slate-500 uppercase font-black tracking-widest mr-2">ソート対象:</span>
                    {RATE_TYPES.map(opt => (
                        <button
                            key={opt.id}
                            onClick={() => setSortBy(opt.id)}
                            className={`text-[11px] px-4 py-2 rounded-xl border transition-all duration-300 ${sortBy === opt.id
                                ? `bg-${opt.color}-500/20 border-${opt.color}-500/50 text-${opt.color}-400 shadow-lg shadow-${opt.color}-500/10`
                                : 'bg-white/5 border-white/10 text-slate-400 hover:bg-white/10'
                                }`}
                        >
                            {opt.fullLabel}
                        </button>
                    ))}
                </div>
            </div>

            {/* Table Section */}
            <div className="glass rounded-3xl p-8 mb-12 overflow-hidden border border-white/5 shadow-2xl">
                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <div className={`p-2 rounded-lg bg-${activeRateType.color}-500/20`}>
                            <TableIcon className={`w-6 h-6 text-${activeRateType.color}-400`} />
                        </div>
                        <h2 className="text-xl font-bold text-white">金利比較データ一覧</h2>
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-slate-500 uppercase tracking-widest font-bold no-print">
                        <div className={`w-2 h-2 rounded-full bg-${activeRateType.color}-500 animate-pulse`} />
                        {activeRateType.fullLabel}でソート中
                    </div>
                </div>

                {/* Mobile Scroll Hint */}
                <div className="md:hidden flex items-center justify-center gap-2 mb-4 py-3 px-4 bg-blue-500/10 border border-blue-500/20 rounded-2xl text-blue-300 text-[11px] font-bold tracking-widest no-print">
                    <MoveHorizontal className="w-4 h-4 animate-bounce-horizontal" />
                    <span>左右にスライドして詳細を確認できます</span>
                </div>

                <div className="overflow-x-auto print-overflow-visible">
                    <table className="w-full text-left border-collapse print-table">
                        <thead>
                            <tr className="border-b border-white/10">
                                <th className="py-5 px-6 text-[11px] font-black text-slate-400 uppercase tracking-widest bg-white/[0.01]">銀行名</th>
                                {RATE_TYPES.map(type => {
                                    const isSorted = sortBy === type.id;
                                    return (
                                        <th
                                            key={type.id}
                                            className={`py-5 px-4 text-[11px] font-black uppercase tracking-widest text-center transition-all duration-500 relative ${isSorted
                                                ? `text-${type.color}-400 bg-${type.color}-500/10`
                                                : 'text-slate-500 bg-transparent'
                                                }`}
                                        >
                                            {type.label}
                                            {isSorted && (
                                                <div className={`absolute bottom-0 left-0 right-0 h-1 bg-${type.color}-500`} />
                                            )}
                                        </th>
                                    );
                                })}
                                <th className="py-5 px-6 text-[11px] font-black text-slate-400 uppercase tracking-widest bg-white/[0.01] text-center w-[300px]">特色・キャンペーン</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredRates.map((bank, i) => (
                                <tr key={i} className="border-b border-white/5 hover:bg-white/[0.03] transition-colors group">
                                    <td className="py-5 px-6 font-bold text-slate-200 border-r border-white/5 whitespace-nowrap">
                                        <a
                                            href={bank.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-2 hover:text-blue-400 transition-colors group/link"
                                        >
                                            {bank.name}
                                            <ExternalLink className="w-3 h-3 opacity-0 group-hover/link:opacity-100 transition-all transform translate-y-0.5" />
                                        </a>
                                    </td>
                                    {RATE_TYPES.map(type => {
                                        const isSorted = sortBy === type.id;
                                        return (
                                            <td
                                                key={type.id}
                                                className={`py-5 px-4 text-center transition-all duration-500 ${isSorted ? `bg-${type.color}-500/[0.12]` : ''
                                                    }`}
                                            >
                                                <div className="flex flex-col items-center gap-0.5">
                                                    <span
                                                        className={`text-sm transition-all duration-300 ${isSorted ? 'font-black scale-125 inline-block' : 'opacity-90 font-medium'}`}
                                                        style={{
                                                            color: isSorted ? type.hex : '#ffffff',
                                                            textShadow: isSorted ? `0 0 15px ${type.hex}88` : 'none'
                                                        }}
                                                    >
                                                        {bank[type.id] ? `${bank[type.id]}%` : '-'}
                                                    </span>
                                                    {type.id === 'variable' && bank.baseRateVariable && bank.variable && (
                                                        <div className="flex flex-col items-center -mt-0.5 opacity-60">
                                                            <span className="text-[9px] font-bold text-slate-400 line-through decoration-slate-500/50">
                                                                店 {bank.baseRateVariable}%
                                                            </span>
                                                            <span className="text-[10px] font-black text-rose-400/90 tracking-tighter">
                                                                -{(bank.baseRateVariable - bank.variable).toFixed(3)}%
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        );
                                    })}
                                    <td className="py-5 px-6 text-[13px] text-slate-400 leading-relaxed border-l border-white/5 min-w-[300px]">
                                        <div className="flex flex-col gap-1">
                                            {bank.remarks}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <style>{`
                @media print {
                    @page {
                        size: A4 portrait;
                        margin: 3mm 5mm;
                    }
                    body {
                        background: white !important;
                        color: black !important;
                        margin: 0;
                        padding: 0;
                        font-family: "Hiragino Kaku Gothic ProN", "Meiryo", sans-serif;
                    }
                    /* 不要な要素を完全に非表示 (Dashboard, 検索窓, ソート対象, 統計, タイトル等) */
                    header, footer, .no-print, .grid, svg, h1, h2, h3 {
                        display: none !important;
                    }
                    
                    /* コンテナの余白を削除して領域を最大限活用 */
                    .max-w-7xl, .py-12 {
                        max-width: 100% !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    /* ブラウザの枠線や背景を排除 */
                    .glass {
                        background: transparent !important;
                        border: none !important;
                        box-shadow: none !important;
                        padding: 0 !important;
                        margin: 0 !important;
                    }

                    /* 最小限のタイトル表示 */
                    h2 {
                        display: block !important;
                        font-size: 12px !important;
                        font-weight: bold !important;
                        margin: 0 0 5px 0 !important;
                        padding: 0 !important;
                        text-align: center !important;
                        color: black !important;
                    }

                    /* テーブルを1ページに収めるための極限設定 */
                    table {
                        width: 100% !important;
                        table-layout: fixed !important;
                        border-collapse: collapse !important;
                        border: 0.5pt solid #000 !important;
                    }

                    th, td {
                        padding: 1px 2px !important;
                        border: 0.5pt solid #888 !important;
                        font-size: 7.5px !important;
                        color: black !important;
                        line-height: 1.0 !important;
                        word-break: break-all !important;
                        white-space: normal !important; /* 折り返しを許可 */
                    }

                    /* 金利の数字を均一化（ソート中の強調や色をリセット） */
                    td span {
                        color: black !important;
                        font-size: 7.5px !important;
                        font-weight: bold !important;
                        text-shadow: none !important;
                        transform: none !important;
                        display: inline !important;
                        background: none !important;
                    }

                    th {
                        background: #f0f0f0 !important;
                        font-weight: 900 !important;
                    }

                    /* 列幅の再調整: 銀行名の幅を広げてはみ出しを防ぐ */
                    th:nth-child(1), td:nth-child(1) { 
                        width: 22% !important; 
                        text-align: left !important;
                    } 
                    th:nth-child(2), th:nth-child(3), th:nth-child(4), 
                    th:nth-child(5), th:nth-child(6), th:nth-child(7),
                    td:nth-child(2), td:nth-child(3), td:nth-child(4), 
                    td:nth-child(5), td:nth-child(6), td:nth-child(7) { 
                        width: 7.5% !important; 
                    }
                    th:last-child, td:last-child { width: auto !important; }

                    /* 変動金利表示の微調整 */
                    .flex-col { display: block !important; }
                    .text-rose-400\\/90 { color: #c00 !important; display: block !important; font-weight: bold !important; }
                    .opacity-60 { font-size: 6.5px !important; }

                    /* 装飾リセット */
                    * {
                        box-shadow: none !important;
                        text-shadow: none !important;
                        border-radius: 0 !important;
                    }
                    tr { page-break-inside: avoid !important; }
                }
            `}</style>
        </div >
    );
};

export default App;
