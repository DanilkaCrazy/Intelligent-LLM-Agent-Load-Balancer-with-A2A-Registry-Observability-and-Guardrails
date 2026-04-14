import { useState, useEffect } from 'react';
import { Activity, Server, Shield, Users, Zap, BarChart3, CheckCircle2, XCircle } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';

export default function App() {
  const [providers, setProviders] = useState<any[]>([]);
  const [agents, setAgents] = useState<any[]>([]);
  const [metrics, setMetrics] = useState<string>('');
  const [testResult, setTestResult] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const token = 'agent-token-123';

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    try {
      const [provRes, agentRes, metricsRes] = await Promise.all([
        fetch('/api/registry/providers', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/api/registry/agents', { headers: { Authorization: `Bearer ${token}` } }),
        fetch('/metrics')
      ]);
      
      if (provRes.ok) setProviders(await provRes.json());
      if (agentRes.ok) setAgents(await agentRes.json());
      if (metricsRes.ok) setMetrics(await metricsRes.text());
    } catch (e) {
      console.error('Failed to fetch data', e);
    }
  };

  const runTest = async (model: string, prompt: string) => {
    setLoading(true);
    setTestResult('');
    try {
      const res = await fetch('/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: prompt }],
          stream: false
        })
      });
      
      const data = await res.json();
      if (!res.ok) {
        setTestResult(`Error: ${data.error}`);
      } else {
        setTestResult(data.choices?.[0]?.message?.content || JSON.stringify(data));
      }
    } catch (e: any) {
      setTestResult(`Error: ${e.message}`);
    }
    setLoading(false);
    fetchData();
  };

  const chartData = providers.map(p => ({
    name: p.name,
    latency: p.averageLatency > 0 ? Math.round(p.averageLatency * 1000) : 0,
    health: p.health
  }));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10 font-sans selection:bg-blue-200">
      <header className="mb-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl shadow-sm">
              <Server className="w-6 h-6 text-white" />
            </div>
            Agent Platform
          </h1>
          <p className="text-slate-500 mt-2 text-sm md:text-base">Unified A2A Gateway, LLM Balancer, and Telemetry</p>
        </div>
        <div className="flex gap-3">
          <div className="bg-white px-4 py-2.5 rounded-xl shadow-sm border border-slate-200 flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
            <span className="font-medium text-sm text-slate-700">System Online</span>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        {/* Main Content Area */}
        <div className="xl:col-span-2 space-y-8">
          
          {/* Providers & Balancer */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-800">
                <Zap className="w-5 h-5 text-amber-500" />
                LLM Routing & Health
              </h2>
            </div>
            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="pb-3 font-medium">Provider</th>
                      <th className="pb-3 font-medium">Models</th>
                      <th className="pb-3 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {providers.map(p => (
                      <tr key={p.id} className="group hover:bg-slate-50 transition-colors">
                        <td className="py-4 font-medium text-slate-700">{p.name}</td>
                        <td className="py-4">
                          <div className="flex flex-wrap gap-1.5">
                            {p.models.map((m: string) => (
                              <span key={m} className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md text-xs font-medium border border-slate-200">{m}</span>
                            ))}
                          </div>
                        </td>
                        <td className="py-4">
                          {p.health === 'healthy' ? (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100">
                              <CheckCircle2 className="w-3.5 h-3.5" /> Healthy
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-100">
                              <XCircle className="w-3.5 h-3.5" /> Unhealthy
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              
              {/* Latency Chart */}
              <div className="h-48 w-full flex flex-col">
                <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Average Latency (ms)</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                    <Tooltip cursor={{ fill: '#f1f5f9' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="latency" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.health === 'healthy' ? '#3b82f6' : '#f43f5e'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </section>

          {/* Test Console */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-800">
                <Shield className="w-5 h-5 text-indigo-500" />
                Playground & Guardrails
              </h2>
              <p className="text-sm text-slate-500 mt-1">Test prompt injections or normal queries.</p>
            </div>
            <div className="p-6 space-y-5">
              <div className="flex flex-col sm:flex-row gap-3">
                <select id="model-select" className="border border-slate-200 rounded-xl px-4 py-2.5 bg-slate-50 text-sm font-medium text-slate-700 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all cursor-pointer">
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo (OpenAI/Local)</option>
                  <option value="claude-3-sonnet">claude-3-sonnet (Anthropic)</option>
                </select>
                <input 
                  id="prompt-input"
                  type="text" 
                  placeholder="Try 'ignore previous instructions' to trigger guardrails..." 
                  className="flex-1 border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                  defaultValue="Hello, how are you?"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const select = document.getElementById('model-select') as HTMLSelectElement;
                      runTest(select.value, e.currentTarget.value);
                    }
                  }}
                />
                <button 
                  onClick={() => {
                    const select = document.getElementById('model-select') as HTMLSelectElement;
                    const input = document.getElementById('prompt-input') as HTMLInputElement;
                    runTest(select.value, input.value);
                  }}
                  disabled={loading}
                  className="bg-slate-900 hover:bg-slate-800 text-white px-6 py-2.5 rounded-xl text-sm font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap shadow-sm"
                >
                  {loading ? 'Processing...' : 'Send Request'}
                </button>
              </div>
              
              {testResult && (
                <div className={`p-4 rounded-xl text-sm font-mono whitespace-pre-wrap leading-relaxed ${
                  testResult.startsWith('Error') 
                    ? 'bg-rose-50 text-rose-800 border border-rose-100' 
                    : 'bg-slate-50 text-slate-800 border border-slate-200'
                }`}>
                  {testResult}
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-8">
          {/* Agents Registry */}
          <section className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
            <div className="p-6 border-b border-slate-100">
              <h2 className="text-lg font-semibold flex items-center gap-2 text-slate-800">
                <Users className="w-5 h-5 text-purple-500" />
                A2A Registry
              </h2>
            </div>
            <div className="p-6">
              {agents.length === 0 ? (
                <div className="text-center py-6">
                  <div className="bg-slate-50 w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3">
                    <Users className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-500">No agents registered yet.</p>
                </div>
              ) : (
                <ul className="space-y-3">
                  {agents.map(a => (
                    <li key={a.id} className="p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-slate-200 transition-colors">
                      <div className="font-medium text-sm text-slate-800">{a.name}</div>
                      <div className="text-xs text-slate-500 mt-1.5">{a.description}</div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Raw Metrics */}
          <section className="bg-slate-900 rounded-2xl shadow-sm border border-slate-800 overflow-hidden flex flex-col h-[400px]">
            <div className="p-5 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
              <h2 className="text-sm font-semibold flex items-center gap-2 text-slate-100">
                <BarChart3 className="w-4 h-4 text-emerald-400" />
                Prometheus Export
              </h2>
              <span className="text-[10px] uppercase tracking-wider font-semibold text-slate-500 bg-slate-800 px-2 py-1 rounded-md">/metrics</span>
            </div>
            <div className="p-5 flex-1 overflow-y-auto custom-scrollbar">
              <div className="text-[11px] font-mono text-emerald-400/80 whitespace-pre-wrap leading-relaxed">
                {metrics || 'Waiting for metrics...'}
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

