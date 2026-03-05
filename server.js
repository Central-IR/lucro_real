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

// Middleware de autenticação (público para as rotas de teste)
async function verificarAutenticacao(req, res, next) {
    const publicPaths = [
        '/',
        '/api/health',
        '/api/test/todos-fretes',
        '/api/test/frete/:id',
        '/api/debug/fretes',
        '/api/debug/lucro-real',
        '/api/carga-inicial',
        '/api/monitorar-pedidos'
    ];
    if (publicPaths.includes(req.path)) {
        return next();
    }

    const sessionToken = req.headers['x-session-token'];
    if (!sessionToken) {
        return res.status(401).json({ error: 'Token de sessão não fornecido' });
    }

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

// Rota de health
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ROTA DE TESTE - retorna todos os fretes
app.get('/api/test/todos-fretes', async (req, res) => {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/controle_frete?select=*`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        if (!response.ok) throw new Error(await response.text());
        const data = await response.json();
        res.json({ quantidade: data.length, amostra: data.slice(0, 2) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROTA DE TESTE PARA UM FRETE ESPECÍFICO
app.get('/api/test/frete/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const response = await fetch(`${SUPABASE_URL}/rest/v1/controle_frete?id=eq.${id}`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const data = await response.json();
        res.json(data[0] || null);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Funções auxiliares
function parseValorMonetario(valor) {
    if (!valor) return 0;
    // Converte para string e trata formato brasileiro (ex: "1.234,56" ou "1234.56")
    let str = String(valor).replace(/\./g, '').replace(',', '.');
    const num = parseFloat(str);
    return isNaN(num) ? 0 : num;
}

function calcularValores(venda) {
    const comissao = venda * (1.25 / 100);
    const impostoFederal = venda * (11 / 100);
    return { comissao, impostoFederal };
}

async function obterRegistroExistente(codigo) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${codigo}`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const data = await res.json();
        return data[0] || null;
    } catch (error) {
        console.error('Erro ao obter registro:', error);
        return null;
    }
}

async function criarRegistroLucroReal(frete) {
    try {
        const venda = parseValorMonetario(frete.valor_nf);
        const { comissao, impostoFederal } = calcularValores(venda);
        const freteValor = parseValorMonetario(frete.valor_frete);
        console.log(`📊 frete.id=${frete.id}, venda=${venda}, freteValor=${freteValor}, comissao=${comissao}, impostoFederal=${impostoFederal}`);

        const lucroReal = venda - freteValor - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;

        const numeroNF = frete.numero_nf && frete.numero_nf.trim() !== '' ? frete.numero_nf : '-';
        const dataEmissao = (frete.data_emissao || new Date().toISOString()).split('T')[0];

        const registro = {
            codigo: frete.id,
            nf: numeroNF,
            vendedor: frete.vendedor || '',
            venda: venda,
            custo: 0,
            frete: freteValor,
            comissao: comissao,
            imposto_federal: impostoFederal,
            lucro_real: lucroReal,
            margem_liquida: margemLiquida,
            data_emissao: dataEmissao
        };

        console.log('📤 Criando registro no lucro_real:', JSON.stringify(registro));

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
            // Se o erro for de duplicata, tenta atualizar
            if (response.status === 409 && erro.includes('duplicate key')) {
                console.log('⚠️ Registro já existe, tentando atualizar...');
                const existente = await obterRegistroExistente(frete.id);
                if (existente) {
                    return await atualizarRegistroLucroReal(frete, existente);
                }
            }
            console.error('❌ Erro na inserção:', erro);
            return false;
        }
        console.log(`✅ Registro criado para frete ${frete.id} (NF: ${numeroNF})`);
        return true;
    } catch (error) {
        console.error('❌ Exceção em criarRegistro:', error);
        return false;
    }
}

async function atualizarRegistroLucroReal(frete, existente) {
    try {
        const venda = parseValorMonetario(frete.valor_nf);
        const { comissao, impostoFederal } = calcularValores(venda);
        const freteValor = parseValorMonetario(frete.valor_frete);
        const custoAtual = existente.custo || 0;
        const lucroReal = venda - custoAtual - freteValor - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;

        const numeroNF = frete.numero_nf && frete.numero_nf.trim() !== '' ? frete.numero_nf : '-';
        const dataEmissao = (frete.data_emissao || existente.data_emissao).split('T')[0];

        const updates = {
            nf: numeroNF,
            vendedor: frete.vendedor || '',
            venda: venda,
            frete: freteValor,
            comissao: comissao,
            imposto_federal: impostoFederal,
            lucro_real: lucroReal,
            margem_liquida: margemLiquida,
            data_emissao: dataEmissao
        };

        console.log('📤 Atualizando registro no lucro_real:', JSON.stringify(updates));

        const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${frete.id}`, {
            method: 'PATCH',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            const erro = await response.text();
            console.error('❌ Erro na atualização:', erro);
            return false;
        }
        console.log(`🔄 Registro atualizado para frete ${frete.id} (NF: ${numeroNF})`);
        return true;
    } catch (error) {
        console.error('❌ Exceção em atualizarRegistro:', error);
        return false;
    }
}

// 🔍 Função para verificar se o tipo_nf deve ser processado (apenas ENVIO)
function deveProcessarFrete(frete) {
    // Se não tiver tipo_nf ou for vazio, não processa
    const tipo = frete.tipo_nf ? frete.tipo_nf.trim() : null;
    // Apenas 'ENVIO' é permitido
    return tipo === 'ENVIO';
}

async function processarFrete(frete) {
    if (!deveProcessarFrete(frete)) {
        console.log(`⏭️ Ignorando frete ${frete.id} (tipo: ${frete.tipo_nf})`);
        return true; // ignorado, mas considerado processado para não gerar erro
    }

    console.log(`⚙️ Processando frete ${frete.id} (NF: ${frete.numero_nf || '-'})`);
    const existente = await obterRegistroExistente(frete.id);
    if (existente) {
        return await atualizarRegistroLucroReal(frete, existente);
    } else {
        return await criarRegistroLucroReal(frete);
    }
}

// CARGA COMPLETA (todos os fretes)
app.get('/api/carga-inicial', async (req, res) => {
    console.log('🔄 Iniciando carga completa de todos os fretes...');
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/controle_frete?select=*`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const fretes = await response.json();
        console.log(`📦 ${fretes.length} fretes encontrados`);
        let processados = 0;
        for (const f of fretes) {
            if (await processarFrete(f)) processados++;
        }
        res.json({ success: true, total: processados });
    } catch (error) {
        console.error('❌ Erro na carga:', error);
        res.status(500).json({ error: error.message });
    }
});

// MONITORAMENTO RÁPIDO (últimos 2 minutos)
app.get('/api/monitorar-pedidos', async (req, res) => {
    console.log(`🔍 [${new Date().toLocaleTimeString()}] Verificando fretes recentes...`);
    try {
        const doisMinutosAtras = new Date(Date.now() - 2 * 60 * 1000).toISOString();
        const url = `${SUPABASE_URL}/rest/v1/controle_frete?select=*&updated_at=gte.${doisMinutosAtras}&order=updated_at.asc`;
        const response = await fetch(url, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const fretes = await response.json();
        console.log(`📦 ${fretes.length} fretes recentes`);
        for (const f of fretes) {
            await processarFrete(f);
        }
        res.json({ success: true, quantidade: fretes.length });
    } catch (error) {
        console.error('❌ Erro no monitoramento:', error);
        res.status(500).json({ error: error.message });
    }
});

// DEBUG: ver fretes do controle_frete
app.get('/api/debug/fretes', async (req, res) => {
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/controle_frete?select=id,numero_nf,vendedor,valor_nf,valor_frete,tipo_nf,data_emissao,updated_at&order=updated_at.desc&limit=20`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const data = await resp.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// DEBUG: ver registros do lucro real
app.get('/api/debug/lucro-real', async (req, res) => {
    try {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?select=*&order=created_at.desc&limit=20`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
        const data = await resp.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ROTA PRINCIPAL – dados para o frontend (protegida)
app.get('/api/lucro-real', verificarAutenticacao, async (req, res) => {
    try {
        const { mes, ano } = req.query;
        let supabaseUrl;
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes);
            const year = parseInt(ano);
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0);
            const startStr = startDate.toISOString().split('T')[0];
            const endStr = endDate.toISOString().split('T')[0];
            supabaseUrl = `${SUPABASE_URL}/rest/v1/lucro_real?select=*&data_emissao=gte.${startStr}&data_emissao=lte.${endStr}&order=data_emissao.asc`;
        } else if (ano !== undefined) {
            const year = parseInt(ano);
            const startDate = new Date(year, 0, 1);
            const endDate = new Date(year, 11, 31);
            const startStr = startDate.toISOString().split('T')[0];
            const endStr = endDate.toISOString().split('T')[0];
            supabaseUrl = `${SUPABASE_URL}/rest/v1/lucro_real?select=*&data_emissao=gte.${startStr}&data_emissao=lte.${endStr}`;
        } else {
            return res.status(400).json({ error: 'Mês/ano ou ano são obrigatórios' });
        }

        const response = await fetch(supabaseUrl, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error('❌ Erro Supabase:', errorText);
            throw new Error(`Supabase erro ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao buscar lucro real:', error.message);
        res.status(500).json({ error: 'Erro ao buscar lucro real', details: error.message });
    }
});

// ROTA PARA EDIÇÃO MANUAL (custo, comissão, imposto)
app.patch('/api/lucro-real/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        const getResponse = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`, {
            headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
        });
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

        updates.lucro_real = registro.venda - novoCusto - (registro.frete || 0) - novaComissao - novoImposto;
        updates.margem_liquida = registro.venda ? updates.lucro_real / registro.venda : 0;

        const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`, {
            method: 'PATCH',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify(updates)
        });

        if (!response.ok) {
            const erro = await response.text();
            console.error('Erro no PATCH Supabase:', erro);
            throw new Error('Erro ao atualizar lucro real');
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar lucro real', details: error.message });
    }
});

// Servir frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`🚀 Servidor rodando na porta ${PORT}`);
    // Carga inicial após 3 segundos
    setTimeout(() => {
        console.log('⏳ Executando carga inicial...');
        fetch(`http://localhost:${PORT}/api/carga-inicial`).catch(console.error);
    }, 3000);
    // Monitoramento a cada 15 segundos
    setInterval(() => {
        fetch(`http://localhost:${PORT}/api/monitorar-pedidos`).catch(console.error);
    }, 15 * 1000);
});
