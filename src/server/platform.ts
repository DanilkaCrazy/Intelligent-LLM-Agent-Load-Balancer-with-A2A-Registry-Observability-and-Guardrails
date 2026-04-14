import { Express, Request, Response, NextFunction } from 'express';
import promClient from 'prom-client';
import { v4 as uuidv4 } from 'uuid';

// --- Metrics Setup ---
const collectDefaultMetrics = promClient.collectDefaultMetrics;
collectDefaultMetrics({ prefix: 'agent_platform_' });

const requestCounter = new promClient.Counter({
  name: 'agent_platform_requests_total',
  help: 'Total number of requests',
  labelNames: ['method', 'route', 'status', 'provider'],
});

const responseLatency = new promClient.Histogram({
  name: 'agent_platform_response_latency_seconds',
  help: 'Response latency in seconds',
  labelNames: ['method', 'route', 'status', 'provider'],
  buckets: [0.1, 0.5, 1, 2, 5, 10],
});

const ttftHistogram = new promClient.Histogram({
  name: 'agent_platform_ttft_seconds',
  help: 'Time to first token in seconds',
  labelNames: ['provider', 'model'],
  buckets: [0.05, 0.1, 0.2, 0.5, 1, 2],
});

const tpotHistogram = new promClient.Histogram({
  name: 'agent_platform_tpot_seconds',
  help: 'Time per output token in seconds',
  labelNames: ['provider', 'model'],
  buckets: [0.01, 0.05, 0.1, 0.2, 0.5],
});

const tokenCounter = new promClient.Counter({
  name: 'agent_platform_tokens_total',
  help: 'Total tokens processed',
  labelNames: ['provider', 'model', 'type'], // type: 'input' | 'output'
});

const costCounter = new promClient.Counter({
  name: 'agent_platform_cost_usd_total',
  help: 'Total cost in USD',
  labelNames: ['provider', 'model'],
});

// --- In-Memory Registries ---
interface Agent {
  id: string;
  name: string;
  description: string;
  supportedMethods: string[];
}

interface Provider {
  id: string;
  name: string;
  url: string;
  models: string[];
  pricePerInputToken: number;
  pricePerOutputToken: number;
  limits: { rpm: number; tpm: number };
  priority: number;
  health: 'healthy' | 'unhealthy';
  averageLatency: number;
  errorCount: number;
}

const agents: Map<string, Agent> = new Map();
const providers: Map<string, Provider> = new Map();

// Initialize some mock providers
providers.set('mock-openai', {
  id: 'mock-openai',
  name: 'Mock OpenAI',
  url: 'http://localhost:3000/mock/openai/v1/chat/completions',
  models: ['gpt-4', 'gpt-3.5-turbo'],
  pricePerInputToken: 0.00001,
  pricePerOutputToken: 0.00003,
  limits: { rpm: 1000, tpm: 100000 },
  priority: 1,
  health: 'healthy',
  averageLatency: 0,
  errorCount: 0,
});

providers.set('mock-anthropic', {
  id: 'mock-anthropic',
  name: 'Mock Anthropic',
  url: 'http://localhost:3000/mock/anthropic/v1/messages',
  models: ['claude-3-opus', 'claude-3-sonnet'],
  pricePerInputToken: 0.000015,
  pricePerOutputToken: 0.000075,
  limits: { rpm: 500, tpm: 50000 },
  priority: 2,
  health: 'healthy',
  averageLatency: 0,
  errorCount: 0,
});

providers.set('mock-local', {
  id: 'mock-local',
  name: 'Mock Local LLM',
  url: 'http://localhost:3000/mock/local/v1/chat/completions',
  models: ['llama-3-8b', 'gpt-3.5-turbo'], // overlaps with openai for load balancing
  pricePerInputToken: 0.000001,
  pricePerOutputToken: 0.000002,
  limits: { rpm: 100, tpm: 10000 },
  priority: 3,
  health: 'healthy',
  averageLatency: 0,
  errorCount: 0,
});

// --- Guardrails ---
function checkGuardrails(prompt: string): { safe: boolean; reason?: string } {
  const lowerPrompt = prompt.toLowerCase();
  if (lowerPrompt.includes('ignore previous instructions') || lowerPrompt.includes('system prompt')) {
    return { safe: false, reason: 'Potential prompt injection detected.' };
  }
  if (prompt.match(/AKIA[0-9A-Z]{16}/) || prompt.match(/sk-[a-zA-Z0-9]{48}/)) {
    return { safe: false, reason: 'Potential secret leak detected.' };
  }
  return { safe: true };
}

// --- Auth Middleware ---
const validTokens = new Set(['agent-token-123', 'admin-token-456']);
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Missing token' });
  }
  const token = authHeader.split(' ')[1];
  if (!validTokens.has(token)) {
    return res.status(403).json({ error: 'Forbidden: Invalid token' });
  }
  next();
}

// --- Balancer Logic ---
let rrIndex = 0;
function selectProvider(model: string): Provider | null {
  const available = Array.from(providers.values()).filter(
    (p) => p.models.includes(model) && p.health === 'healthy'
  );

  if (available.length === 0) return null;

  // Level 2: Latency-based and Health-aware routing
  // Sort by priority first, then by latency
  available.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.averageLatency - b.averageLatency;
  });

  // If priorities and latencies are similar, use Round Robin
  const bestProviders = available.filter(
    (p) => p.priority === available[0].priority
  );

  const selected = bestProviders[rrIndex % bestProviders.length];
  rrIndex++;
  return selected;
}

function updateProviderHealth(providerId: string, latency: number, isError: boolean) {
  const p = providers.get(providerId);
  if (!p) return;

  if (isError) {
    p.errorCount++;
    if (p.errorCount > 3) {
      p.health = 'unhealthy';
      console.log(`Provider ${p.name} marked as unhealthy.`);
      // Simple recovery mechanism: mark healthy after 30 seconds
      setTimeout(() => {
        p.health = 'healthy';
        p.errorCount = 0;
        console.log(`Provider ${p.name} recovered and marked as healthy.`);
      }, 30000);
    }
  } else {
    p.errorCount = 0;
    // Exponential moving average for latency
    p.averageLatency = p.averageLatency === 0 ? latency : p.averageLatency * 0.8 + latency * 0.2;
  }
}

// --- Setup Function ---
export function setupPlatform(app: Express) {
  // Metrics Endpoint
  app.get('/metrics', async (req, res) => {
    res.set('Content-Type', promClient.register.contentType);
    res.end(await promClient.register.metrics());
  });

  // Health Check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // --- Registry API ---
  app.post('/api/registry/agents', authMiddleware, (req, res) => {
    const agent: Agent = { id: uuidv4(), ...req.body };
    agents.set(agent.id, agent);
    res.status(201).json(agent);
  });

  app.get('/api/registry/agents', authMiddleware, (req, res) => {
    res.json(Array.from(agents.values()));
  });

  app.post('/api/registry/providers', authMiddleware, (req, res) => {
    const provider: Provider = {
      id: uuidv4(),
      health: 'healthy',
      averageLatency: 0,
      errorCount: 0,
      ...req.body,
    };
    providers.set(provider.id, provider);
    res.status(201).json(provider);
  });

  app.get('/api/registry/providers', authMiddleware, (req, res) => {
    res.json(Array.from(providers.values()));
  });

  // --- Main Balancer Endpoint ---
  app.post('/api/v1/chat/completions', authMiddleware, async (req, res) => {
    const startTime = Date.now();
    const { model, messages, stream } = req.body;

    if (!model || !messages) {
      return res.status(400).json({ error: 'Missing model or messages' });
    }

    // Guardrails
    const lastMessage = messages[messages.length - 1]?.content || '';
    const guard = checkGuardrails(lastMessage);
    if (!guard.safe) {
      requestCounter.inc({ method: 'POST', route: '/api/v1/chat/completions', status: 403, provider: 'guardrails' });
      return res.status(403).json({ error: guard.reason });
    }

    const provider = selectProvider(model);
    if (!provider) {
      requestCounter.inc({ method: 'POST', route: '/api/v1/chat/completions', status: 503, provider: 'none' });
      return res.status(503).json({ error: 'No healthy providers available for this model' });
    }

    try {
      // Simulate proxying to the selected provider
      const response = await fetch(provider.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body),
      });

      if (!response.ok) {
        throw new Error(`Provider returned ${response.status}`);
      }

      const latency = (Date.now() - startTime) / 1000;
      updateProviderHealth(provider.id, latency, false);
      responseLatency.observe({ method: 'POST', route: '/api/v1/chat/completions', status: 200, provider: provider.name }, latency);
      requestCounter.inc({ method: 'POST', route: '/api/v1/chat/completions', status: 200, provider: provider.name });

      if (stream) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        let firstTokenTime: number | null = null;
        let outputTokens = 0;
        const inputTokens = Math.ceil(lastMessage.length / 4); // rough estimate

        if (response.body) {
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            if (!firstTokenTime) {
              firstTokenTime = (Date.now() - startTime) / 1000;
              ttftHistogram.observe({ provider: provider.name, model }, firstTokenTime);
            }
            
            outputTokens++;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
          }
          
          const totalTime = (Date.now() - startTime) / 1000;
          if (outputTokens > 0) {
            tpotHistogram.observe({ provider: provider.name, model }, (totalTime - (firstTokenTime || 0)) / outputTokens);
          }
          
          tokenCounter.inc({ provider: provider.name, model, type: 'input' }, inputTokens);
          tokenCounter.inc({ provider: provider.name, model, type: 'output' }, outputTokens);
          
          const cost = (inputTokens * provider.pricePerInputToken) + (outputTokens * provider.pricePerOutputToken);
          costCounter.inc({ provider: provider.name, model }, cost);
          
          res.end();
        }
      } else {
        const data = await response.json();
        
        // Mock token counting
        const inputTokens = Math.ceil(lastMessage.length / 4);
        const outputTokens = Math.ceil((data.choices?.[0]?.message?.content?.length || 0) / 4);
        
        tokenCounter.inc({ provider: provider.name, model, type: 'input' }, inputTokens);
        tokenCounter.inc({ provider: provider.name, model, type: 'output' }, outputTokens);
        
        const cost = (inputTokens * provider.pricePerInputToken) + (outputTokens * provider.pricePerOutputToken);
        costCounter.inc({ provider: provider.name, model }, cost);

        res.json(data);
      }
    } catch (error) {
      const latency = (Date.now() - startTime) / 1000;
      updateProviderHealth(provider.id, latency, true);
      requestCounter.inc({ method: 'POST', route: '/api/v1/chat/completions', status: 500, provider: provider.name });
      responseLatency.observe({ method: 'POST', route: '/api/v1/chat/completions', status: 500, provider: provider.name }, latency);
      res.status(500).json({ error: 'Provider error' });
    }
  });

  // --- Mock Providers ---
  app.post('/mock/openai/v1/chat/completions', async (req, res) => {
    const { stream } = req.body;
    // Simulate delay
    await new Promise((r) => setTimeout(r, 500 + Math.random() * 500));
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const words = "This is a mocked response from OpenAI.".split(' ');
      for (const word of words) {
        await new Promise((r) => setTimeout(r, 100));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        choices: [{ message: { content: "This is a mocked response from OpenAI." } }]
      });
    }
  });

  app.post('/mock/anthropic/v1/messages', async (req, res) => {
    const { stream } = req.body;
    await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const words = "This is a mocked response from Anthropic.".split(' ');
      for (const word of words) {
        await new Promise((r) => setTimeout(r, 80));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        choices: [{ message: { content: "This is a mocked response from Anthropic." } }]
      });
    }
  });

  app.post('/mock/local/v1/chat/completions', async (req, res) => {
    const { stream } = req.body;
    await new Promise((r) => setTimeout(r, 100 + Math.random() * 200));
    
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const words = "This is a mocked response from Local LLM.".split(' ');
      for (const word of words) {
        await new Promise((r) => setTimeout(r, 50));
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: word + ' ' } }] })}\n\n`);
      }
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.json({
        choices: [{ message: { content: "This is a mocked response from Local LLM." } }]
      });
    }
  });
}
