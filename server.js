const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORTAL_URL = process.env.PORTAL_URL || 'https://ir-comercio-portal-zcan.onrender.com';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ ERRO: Credenciais do Supabase não configuradas');
    process.exit(1);
}

// Teste de conexão simples
async function testConnection() {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        console.log('🔌 Teste de conexão:', res.ok ? 'OK' : 'Falhou');
    } catch (e) {
        console.error('🔌 Erro de conexão:', e.message);
    }
}
testConnection();

// Middleware de autenticação (simplificado para testes)
async function verificarAutenticacao(req, res, next) {
    const publicPaths = ['/', '/api/health', '/api/test/todos-pedidos', '/api/debug/pedidos', '/api/carga-inicial', '/api/monitorar-pedidos'];
    if (publicPaths.includes(req.path)) return next();
    // ... resto (pode omitir para teste)
    next();
}

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// ROTA DE TESTE CRÍTICA
app.get('/api/test/todos-pedidos', async (req, res) => {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        res.json({ quantidade: data.length, amostra: data.slice(0, 2) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Funções auxiliares (igual antes)
function parseValorMonetario(valor) {
    if (!valor) return 0;
    const cleaned = String(valor).replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
    return parseFloat(cleaned) || 0;
}

function calcularValores(pedido) {
    const venda = parseValorMonetario(pedido.valor_total);
    const frete = parseValorMonetario(pedido.valor_frete);
    const comissao = venda * (1.25 / 100);
    const impostoFederal = venda * (11 / 100);
    return { venda, frete, comissao, impostoFederal };
}

async function obterRegistroExistente(codigo) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${codigo}`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const data = await res.json();
    return data[0] || null;
}

async function criarRegistroLucroReal(pedido) {
    try {
        const { venda, frete, comissao, impostoFederal } = calcularValores(pedido);
        const lucroReal = venda - frete - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;
        const numeroNF = pedido.nf && pedido.nf.trim() ? pedido.nf : '-';
        const dataEmissao = (pedido.data_emissao || pedido.data_registro || new Date().toISOString()).split('T')[0];
        
        const registro = {
            codigo: pedido.codigo,
            nf: numeroNF,
            vendedor: pedido.vendedor || pedido.responsavel || '',
            venda,
            custo: 0,
            frete,
            comissao,
            imposto_federal: impostoFederal,
            lucro_real: lucroReal,
            margem_liquida: margemLiquida,
            data_emissao: dataEmissao
        };
        
        console.log('📤 Enviando para Supabase (lucro_real):', JSON.stringify(registro));
        
        const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify(registro)
        });
        
        if (!response.ok) {
            const erro = await response.text();
            console.error('❌ Erro na inserção:', erro);
            return false;
        }
        console.log(`✅ Registro criado para pedido ${pedido.codigo}`);
        return true;
    } catch (error) {
        console.error('❌ Exceção em criarRegistro:', error);
        return false;
    }
}

async function atualizarRegistroLucroReal(pedido, existente) {
    // similar, com logs
    // ... (omitido por brevidade, mas deve ser incluído)
    return true;
}

async function processarPedido(pedido) {
    console.log(`⚙️ Processando pedido ${pedido.codigo}`);
    const existente = await obterRegistroExistente(pedido.codigo);
    if (existente) {
        return await atualizarRegistroLucroReal(pedido, existente);
    } else {
        return await criarRegistroLucroReal(pedido);
    }
}

// Carga completa
app.get('/api/carga-inicial', async (req, res) => {
    console.log('🔄 Iniciando carga completa...');
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const pedidos = await response.json();
        console.log(`📦 ${pedidos.length} pedidos encontrados`);
        for (const p of pedidos) {
            await processarPedido(p);
        }
        res.json({ success: true, total: pedidos.length });
    } catch (error) {
        console.error('❌ Erro na carga:', error);
        res.status(500).json({ error: error.message });
    }
});

// Monitoramento (simplificado)
app.get('/api/monitorar-pedidos', async (req, res) => {
    // ... (pode chamar a carga completa por enquanto)
    res.json({ message: 'monitoramento' });
});

// Debug
app.get('/api/debug/lucro-real', async (req, res) => {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?select=*`, {
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const data = await resp.json();
    res.json(data);
});

// Servir frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    // Executa carga inicial imediatamente
    setTimeout(() => {
        fetch(`http://localhost:${PORT}/api/carga-inicial`).catch(console.error);
    }, 2000);
});
