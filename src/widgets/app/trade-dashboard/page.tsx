'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useWidgetSDK, WidgetLayout, useTheme } from '@nitrostack/widgets';

interface TradeBreak {
    breakId: string;
    explained: boolean;
    reason: string;
    confidence: string;
}

interface AccuracyStats {
    processed: number;
    resolved: number;
    escalated: number;
}

// Safety fallback if the live pipeline can't be reached / demo mode is toggled on
const initialBreaksData: TradeBreak[] = [
    { breakId: "BRK-001", explained: true, reason: "FX rate discrepancy due to timezone difference in settlement systems. Applied correct rate.", confidence: "high" },
    { breakId: "BRK-002", explained: false, reason: "Trade amount mismatch exceeds standard tolerance. System A reports $50,000; System B reports $5,000.", confidence: "low" },
    { breakId: "BRK-003", explained: true, reason: "Minor rounding error on commission fee (0.01 difference). Auto-resolved.", confidence: "high" },
    { breakId: "BRK-004", explained: false, reason: "Counterparty LEI missing in System B data. Cannot verify trade identity.", confidence: "medium" }
];

const fallbackStats: AccuracyStats = { processed: 4, resolved: 2, escalated: 2 };

// callTool's `result` field is a string. Some tools may also populate
// structuredContent directly — prefer that when present, otherwise JSON.parse result.
function parseToolResult<T>(response: { result: string; structuredContent?: unknown; isError?: boolean }): T {
    if (response.isError) {
        throw new Error(response.result || 'Tool returned an error');
    }
    if (response.structuredContent !== undefined && response.structuredContent !== null) {
        return response.structuredContent as T;
    }
    try {
        return JSON.parse(response.result) as T;
    } catch {
        throw new Error(`Could not parse tool result as JSON: ${response.result}`);
    }
}

export default function Dashboard() {
    const { isReady, callTool } = useWidgetSDK();
    const theme = useTheme();

    const [breaks, setBreaks] = useState<TradeBreak[]>(initialBreaksData);
    const [stats, setStats] = useState<AccuracyStats>(fallbackStats);
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [pipelineStage, setPipelineStage] = useState<string>('');
    const [pipelineError, setPipelineError] = useState<string | null>(null);

    const refreshStats = useCallback(async () => {
        if (isDemoMode || !isReady) return;
        try {
            const response = await callTool('get_accuracy_stats', {});
            const data = parseToolResult<Partial<AccuracyStats>>(response);
            setStats({
                processed: data.processed ?? 0,
                resolved: data.resolved ?? 0,
                escalated: data.escalated ?? 0
            });
        } catch (err) {
            console.error('get_accuracy_stats failed, keeping last known stats.', err);
        }
    }, [isDemoMode, isReady, callTool]);

    // Full pipeline: load_trades -> match_trades -> investigate_break per break
    const runPipeline = useCallback(async () => {
        if (!isReady) return;
        setIsLoading(true);
        setPipelineError(null);

        try {
            setPipelineStage('load_trades');
            const loadResponse = await callTool('load_trades', {});
            const trades = parseToolResult<unknown>(loadResponse);

            setPipelineStage('match_trades');
            const matchResponse = await callTool('match_trades', { trades });
            const matchResult = parseToolResult<{ breaks?: Array<{ breakId: string;[k: string]: unknown }> } | Array<{ breakId: string;[k: string]: unknown }>>(matchResponse);
            const rawBreaks = Array.isArray(matchResult) ? matchResult : (matchResult.breaks ?? []);

            setPipelineStage('investigate_break');
            const investigated: TradeBreak[] = await Promise.all(
                rawBreaks.map(async (b) => {
                    try {
                        const response = await callTool('investigate_break', { breakId: b.breakId, break: b });
                        const result = parseToolResult<Partial<TradeBreak>>(response);
                        return {
                            breakId: b.breakId,
                            explained: result.explained ?? false,
                            reason: result.reason ?? 'No explanation returned',
                            confidence: result.confidence ?? 'unknown'
                        };
                    } catch (err) {
                        console.error(`investigate_break failed for ${b.breakId}`, err);
                        return {
                            breakId: b.breakId,
                            explained: false,
                            reason: 'investigate_break failed for this break — needs manual review',
                            confidence: 'low'
                        };
                    }
                })
            );

            setBreaks(investigated);
            setPipelineStage('');
            await refreshStats();
        } catch (err) {
            console.error('Pipeline failed, falling back to demo data.', err);
            setPipelineError(err instanceof Error ? err.message : 'Unknown pipeline error');
            setBreaks(initialBreaksData);
            setStats(fallbackStats);
        } finally {
            setIsLoading(false);
        }
    }, [isReady, callTool, refreshStats]);

    useEffect(() => {
        if (!isReady) return;
        if (!isDemoMode) {
            runPipeline();
        } else {
            setBreaks(initialBreaksData);
            setStats(fallbackStats);
            setPipelineError(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isReady, isDemoMode]);

    const handleOverride = async (id: string) => {
        setBreaks(currentBreaks =>
            currentBreaks.map(b =>
                b.breakId === id
                    ? { ...b, explained: true, reason: `Manually Overridden: ${b.reason}`, confidence: "high" }
                    : b
            )
        );

        if (isDemoMode || !isReady) {
            setStats(s => ({ ...s, resolved: s.resolved + 1, escalated: Math.max(0, s.escalated - 1) }));
            return;
        }

        try {
            const response = await callTool('resolve_or_escalate', {
                breakId: id,
                resolution: "force_match",
                notes: "Manually overridden by operator via Live Ops Dashboard"
            });
            if (response.isError) {
                console.error(`resolve_or_escalate returned an error for ${id}: ${response.result}`);
            } else {
                console.log(`resolve_or_escalate succeeded for ${id}`);
            }
            await refreshStats();
        } catch (error) {
            console.error(`resolve_or_escalate failed for ${id}`, error);
        }
    };

    const totalBreaks = breaks.length;
    const resolvedBreaks = breaks.filter(b => b.explained).length;
    const pendingBreaks = totalBreaks - resolvedBreaks;
    const dark = theme !== 'light';

    if (!isReady) {
        return (
            <WidgetLayout>
                <div style={{ padding: '40px', textAlign: 'center', color: '#a3a3a3' }}>
                    Connecting to MCP host…
                </div>
            </WidgetLayout>
        );
    }

    return (
        <WidgetLayout>
            <div style={{ padding: '40px', fontFamily: 'system-ui, sans-serif', maxWidth: '900px', margin: '0 auto', backgroundColor: dark ? '#0a0a0a' : '#fafafa', color: dark ? '#ededed' : '#171717', minHeight: '100vh' }}>

                {/* Controls */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <button
                        onClick={runPipeline}
                        disabled={isDemoMode || isLoading}
                        style={{
                            backgroundColor: dark ? '#1a1a1a' : '#eee',
                            color: dark ? '#ededed' : '#171717',
                            border: '1px solid #333',
                            padding: '8px 16px',
                            borderRadius: '20px',
                            cursor: isDemoMode || isLoading ? 'not-allowed' : 'pointer',
                            opacity: isDemoMode || isLoading ? 0.5 : 1
                        }}
                    >
                        ↻ Re-run pipeline
                    </button>

                    <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', backgroundColor: dark ? '#1a1a1a' : '#eee', padding: '8px 16px', borderRadius: '20px', border: '1px solid #333' }}>
                        <input
                            type="checkbox"
                            checked={isDemoMode}
                            onChange={() => setIsDemoMode(!isDemoMode)}
                            style={{ marginRight: '10px' }}
                        />
                        <span style={{ color: isDemoMode ? '#4ade80' : '#3b82f6', fontWeight: 'bold' }}>
                            {isDemoMode ? '🟢 Fallback Data Active' : '🔵 Live Tool Execution Active'}
                        </span>
                    </label>
                </div>

                {/* Header & Stats */}
                <div style={{ borderBottom: '1px solid #333', paddingBottom: '20px', marginBottom: '30px' }}>
                    <h1 style={{ margin: '0 0 10px 0' }}>Trade Matcher Live Ops</h1>
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <div style={{ background: dark ? '#1a1a1a' : '#eee', padding: '10px 20px', borderRadius: '8px' }}>Breaks on screen: <strong>{totalBreaks}</strong></div>
                        <div style={{ background: '#0d2b14', padding: '10px 20px', borderRadius: '8px', color: '#4ade80' }}>Auto-Resolved: <strong>{resolvedBreaks}</strong></div>
                        <div style={{ background: '#3b1212', padding: '10px 20px', borderRadius: '8px', color: '#f87171' }}>Human Review: <strong>{pendingBreaks}</strong></div>
                    </div>

                    {/* Live accuracy stats from get_accuracy_stats */}
                    <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px' }}>
                        <div style={{ background: '#111827', padding: '8px 16px', borderRadius: '8px', color: '#93c5fd', fontSize: '13px' }}>
                            Pipeline processed: <strong>{stats.processed}</strong>
                        </div>
                        <div style={{ background: '#111827', padding: '8px 16px', borderRadius: '8px', color: '#93c5fd', fontSize: '13px' }}>
                            Pipeline resolved: <strong>{stats.resolved}</strong>
                        </div>
                        <div style={{ background: '#111827', padding: '8px 16px', borderRadius: '8px', color: '#93c5fd', fontSize: '13px' }}>
                            Pipeline escalated: <strong>{stats.escalated}</strong>
                        </div>
                    </div>

                    {pipelineError && !isDemoMode && (
                        <div style={{ marginTop: '12px', color: '#f87171', fontSize: '13px' }}>
                            ⚠ Pipeline error: {pipelineError} — showing fallback data.
                        </div>
                    )}
                </div>

                {/* The Feed */}
                <h2>Break Queue</h2>

                {isLoading ? (
                    <div style={{ textAlign: 'center', padding: '40px', color: '#a3a3a3', backgroundColor: '#171717', borderRadius: '6px' }}>
                        <p>⏳ Running pipeline{pipelineStage ? `: ${pipelineStage}` : '...'}</p>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                        {breaks.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: '#a3a3a3', backgroundColor: '#171717', borderRadius: '6px' }}>
                                <p>No trade breaks found. System is fully reconciled!</p>
                            </div>
                        ) : (
                            breaks.map((tradeBreak) => (
                                <div key={tradeBreak.breakId} style={{
                                    borderLeft: tradeBreak.explained ? '5px solid #4ade80' : '5px solid #f87171',
                                    backgroundColor: '#171717',
                                    padding: '20px',
                                    borderRadius: '6px',
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center'
                                }}>
                                    <div>
                                        <h3 style={{ margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            {tradeBreak.breakId}
                                            <span style={{
                                                fontSize: '12px',
                                                padding: '3px 8px',
                                                borderRadius: '12px',
                                                backgroundColor: tradeBreak.explained ? '#0d2b14' : '#3b1212',
                                                color: tradeBreak.explained ? '#4ade80' : '#f87171'
                                            }}>
                                                {tradeBreak.explained ? 'RESOLVED' : 'ACTION REQUIRED'}
                                            </span>
                                        </h3>
                                        <p style={{ margin: 0, color: '#a3a3a3', maxWidth: '500px', lineHeight: '1.5' }}>
                                            {tradeBreak.reason}
                                        </p>
                                    </div>

                                    {!tradeBreak.explained && (
                                        <button
                                            onClick={() => handleOverride(tradeBreak.breakId)}
                                            style={{
                                                backgroundColor: '#dc2626',
                                                color: 'white',
                                                border: 'none',
                                                padding: '12px 20px',
                                                borderRadius: '6px',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                transition: 'background 0.2s'
                                            }}
                                            onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#b91c1c'}
                                            onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#dc2626'}
                                        >
                                            Override & Force Match
                                        </button>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </WidgetLayout>
    );
}
