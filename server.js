const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// ==============================
// CONFIGURAÇÃO
// ==============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORTAL_URL = process.env.PORTAL_URL || 'https://ir-comercio-portal-zcan.onrender.com';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ ERRO: Credenciais do Supabase não configuradas');
    process.exit(1);
}

// ==============================
// FUNÇÕES AUXILIARES
// ==============================
function parseValorMonetario(valor) {
    if (!valor) return 0;
    const cleaned = String(valor)
        .replace('R$', '')
        .replace(/\./g, '')
        .replace(',', '.')
        .trim();
    return parseFloat(cleaned) || 0;
}

function calcularValores(pedido) {
    const venda = parseValorMonetario(pedido.valor_total);
    const frete = parseValorMonetario(pedido.valor_frete);
    const comissao = venda * (1.25 / 100);
    const impostoFederal = venda * (11 / 100);
    return { venda, frete, comissao, impostoFederal };
}

// 🔧 Converte nf para string seguramente
function safeNF(nf) {
    if (nf === null || nf === undefined) return '-';
    const str = String(nf).trim();
    return str === '' ? '-' : str;
}

// ==============================
// FUNÇÕES DE BANCO
// ==============================
async function obterRegistroExistente(codigo) {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${codigo}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );
        if (!response.ok) return null;
        const data = await response.json();
        return data[0] || null;
    } catch (error) {
        console.error('Erro ao obter registro:', error);
        return null;
    }
}

async function criarRegistroLucroReal(pedido) {
    try {
        const { venda, frete, comissao, impostoFederal } = calcularValores(pedido);
        const lucroReal = venda - frete - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;

        const numeroNF = safeNF(pedido.nf);
        const dataEmissao = (pedido.data_emissao || pedido.data_registro || new Date().toISOString()).split('T')[0];

        const registro = {
            codigo: String(pedido.codigo), // garantir string
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

        console.log(`📤 Criando registro para pedido ${pedido.codigo}:`, JSON.stringify(registro));

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
            console.error(`❌ Erro ao criar registro para pedido ${pedido.codigo}:`, erro);
            return false;
        }

        console.log(`✅ Registro criado para pedido ${pedido.codigo} (NF: ${numeroNF})`);
        return true;
    } catch (error) {
        console.error(`❌ Exceção em criarRegistro para pedido ${pedido.codigo}:`, error);
        return false;
    }
}

async function atualizarRegistroLucroReal(pedido, existente) {
    try {
        const { venda, frete, comissao, impostoFederal } = calcularValores(pedido);
        const custoAtual = existente.custo || 0;
        const lucroReal = venda - custoAtual - frete - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;

        const numeroNF = safeNF(pedido.nf);
        const dataEmissao = (pedido.data_emissao || pedido.data_registro || existente.data_emissao).split('T')[0];

        const updates = {
            nf: numeroNF,
            vendedor: pedido.vendedor || pedido.responsavel || '',
            venda,
            frete,
            comissao,
            imposto_federal: impostoFederal,
            lucro_real: lucroReal,
            margem_liquida: margemLiquida,
            data_emissao: dataEmissao
        };

        console.log(`📤 Atualizando registro para pedido ${pedido.codigo}:`, JSON.stringify(updates));

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${pedido.codigo}`,
            {
                method: 'PATCH',
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify(updates)
            }
        );

        if (!response.ok) {
            const erro = await response.text();
            console.error(`❌ Erro ao atualizar registro para pedido ${pedido.codigo}:`, erro);
            return false;
        }

        console.log(`🔄 Registro atualizado para pedido ${pedido.codigo} (NF: ${numeroNF})`);
        return true;
    } catch (error) {
        console.error(`❌ Exceção em atualizarRegistro para pedido ${pedido.codigo}:`, error);
        return false;
    }
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

// ==============================
// ROTAS DE TESTE E DEBUG
// ==============================
app.get('/api/test/supabase', async (req, res) => {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=codigo&limit=1`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

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

app.get('/api/debug/pedidos', async (req, res) => {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=codigo,nf,documento,status,updated_at,data_emissao,data_registro&order=updated_at.desc&limit=20`,
            { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/debug/lucro-real', async (req, res) => {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?select=*&order=created_at.desc&limit=20`,
            { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// CARGA COMPLETA
// ==============================
app.get('/api/carga-inicial', async (req, res) => {
    console.log('🔄 Iniciando carga completa...');
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        if (!response.ok) throw new Error(await response.text());
        const pedidos = await response.json();
        console.log(`📦 Total de pedidos encontrados: ${pedidos.length}`);

        let processados = 0;
        for (const pedido of pedidos) {
            const sucesso = await processarPedido(pedido);
            if (sucesso) processados++;
        }
        console.log(`✅ Carga completa: ${processados} registros processados`);
        res.json({ success: true, total: processados });
    } catch (error) {
        console.error('❌ Erro na carga completa:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// MONITORAMENTO CONTÍNUO
// ==============================
let ultimaVerificacao = new Date(0);

async function verificarPedidosRecentes() {
    try {
        const desde = new Date(ultimaVerificacao.getTime() - 5000).toISOString();
        const url = `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*&updated_at=gte.${desde}&order=updated_at.asc`;
        console.log(`🔍 URL: ${url}`);

        const response = await fetch(url, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });

        if (!response.ok) {
            console.error('Erro ao buscar pedidos:', response.status, await response.text());
            return;
        }

        const pedidos = await response.json();
        ultimaVerificacao = new Date();

        if (pedidos.length === 0) {
            console.log('📭 Nenhum pedido recente');
            return;
        }

        console.log(`📦 ${pedidos.length} pedido(s) recente(s)`);
        for (const pedido of pedidos) {
            await processarPedido(pedido);
        }
    } catch (error) {
        console.error('❌ Erro no monitoramento:', error);
    }
}

app.get('/api/monitorar-pedidos', async (req, res) => {
    await verificarPedidosRecentes();
    res.json({ success: true });
});

// ==============================
// ROTAS PÚBLICAS
// ==============================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==============================
// ROTAS PROTEGIDAS (LUCRO REAL)
// ==============================
async function verificarAutenticacao(req, res, next) {
    const publicPaths = [
        '/', '/api/health', '/api/test/supabase', '/api/test/todos-pedidos',
        '/api/debug/pedidos', '/api/debug/lucro-real',
        '/api/carga-inicial', '/api/monitorar-pedidos'
    ];
    if (publicPaths.includes(req.path)) return next();

    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) return res.status(401).json({ error: 'Token não fornecido' });

    try {
        const response = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        if (!response.ok) return res.status(401).json({ error: 'Sessão inválida' });
        const data = await response.json();
        if (!data.valid) return res.status(401).json({ error: 'Sessão inválida' });
        req.user = data.session;
        req.sessionToken = sessionToken;
        next();
    } catch (error) {
        console.error('Erro ao validar sessão:', error);
        res.status(500).json({ error: 'Erro interno de autenticação' });
    }
}

app.get('/api/lucro-real', verificarAutenticacao, async (req, res) => {
    try {
        const { mes, ano } = req.query;
        if (!mes || !ano) return res.status(400).json({ error: 'Mês e ano são obrigatórios' });

        const month = parseInt(mes);
        const year = parseInt(ano);
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);
        const startStr = startDate.toISOString().split('T')[0];
        const endStr = endDate.toISOString().split('T')[0];

        const url = `${SUPABASE_URL}/rest/v1/lucro_real?select=*&data_emissao=gte.${startStr}&data_emissao=lte.${endStr}&order=data_emissao.asc`;
        const response = await fetch(url, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });

        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao buscar lucro real:', error);
        res.status(500).json({ error: 'Erro ao buscar lucro real' });
    }
});

app.patch('/api/lucro-real/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        const getResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`,
            { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
        );
        if (!getResponse.ok) throw new Error('Erro ao buscar registro');
        const registros = await getResponse.json();
        if (registros.length === 0) return res.status(404).json({ error: 'Registro não encontrado' });

        const registro = registros[0];
        const updates = {};
        if (req.body.custo !== undefined) updates.custo = req.body.custo;
        if (req.body.comissao !== undefined) updates.comissao = req.body.comissao;
        if (req.body.imposto_federal !== undefined) updates.imposto_federal = req.body.imposto_federal;

        const novoCusto = updates.custo ?? registro.custo;
        const novaComissao = updates.comissao ?? registro.comissao;
        const novoImposto = updates.imposto_federal ?? registro.imposto_federal;

        updates.lucro_real = registro.venda - novoCusto - registro.frete - novaComissao - novoImposto;
        updates.margem_liquida = registro.venda ? updates.lucro_real / registro.venda : 0;

        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`,
            {
                method: 'PATCH',
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify(updates)
            }
        );

        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar lucro real' });
    }
});

// ==============================
// SERVIDOR FRONTEND
// ==============================
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==============================
// INICIAR SERVIDOR
// ==============================
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    console.log('🔍 Rotas de teste disponíveis:');
    console.log('   /api/test/supabase');
    console.log('   /api/test/todos-pedidos');
    console.log('   /api/debug/pedidos');
    console.log('   /api/debug/lucro-real');
    console.log('   /api/carga-inicial');
    console.log('   /api/monitorar-pedidos');

    // Executa carga completa após 3 segundos
    setTimeout(async () => {
        console.log('⏳ Executando carga inicial automática...');
        try {
            const response = await fetch(`http://localhost:${PORT}/api/carga-inicial`);
            const result = await response.json();
            console.log('✅ Carga inicial automática concluída:', result);
        } catch (err) {
            console.error('❌ Falha na carga inicial automática:', err.message);
        }
    }, 3000);

    // Monitoramento a cada 15 segundos
    setInterval(verificarPedidosRecentes, 15 * 1000);
});
