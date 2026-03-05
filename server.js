const express = require('express');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

// ==============================
// CONFIGURAÇÃO INICIAL
// ==============================
const app = express();
const PORT = process.env.PORT || 3004;

app.use(cors());
app.use(express.json());

// ==============================
// VARIÁVEIS DE AMBIENTE
// ==============================
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PORTAL_URL = process.env.PORTAL_URL || 'https://ir-comercio-portal-zcan.onrender.com';

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('❌ ERRO: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY não configuradas');
    process.exit(1);
}

// ==============================
// MIDDLEWARE DE AUTENTICAÇÃO
// ==============================
async function verificarAutenticacao(req, res, next) {
    const publicPaths = ['/', '/api/health', '/api/monitorar-pedidos', '/api/carga-inicial', '/api/debug/pedidos'];

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

        if (!response.ok) {
            return res.status(401).json({ error: 'Sessão inválida' });
        }

        const data = await response.json();

        if (!data.valid) {
            return res.status(401).json({ error: 'Sessão inválida' });
        }

        req.user = data.session;
        req.sessionToken = sessionToken;

        next();
    } catch (error) {
        console.error('Erro ao validar sessão:', error);
        res.status(500).json({ error: 'Erro interno de autenticação' });
    }
}

// ==============================
// ROTAS PÚBLICAS
// ==============================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString()
    });
});

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
    return {
        venda,
        frete,
        comissao,
        impostoFederal
    };
}

// ==============================
// FUNÇÕES DE PROCESSAMENTO
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
        const lucroReal = venda - (pedido.custo || 0) - frete - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;

        const numeroNF = pedido.nf && pedido.nf.trim() !== '' ? pedido.nf : '-';

        const registro = {
            codigo: pedido.codigo,
            nf: numeroNF,
            vendedor: pedido.vendedor || pedido.responsavel || '',
            venda: venda,
            custo: 0,
            frete: frete,
            comissao: comissao,
            imposto_federal: impostoFederal,
            lucro_real: lucroReal,
            margem_liquida: margemLiquida,
            data_emissao: pedido.data_emissao || new Date().toISOString().split('T')[0]
        };

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
            console.error('Erro ao criar registro:', erro);
            return false;
        }

        console.log(`✅ Registro criado para pedido ${pedido.codigo} (NF: ${numeroNF})`);
        return true;
    } catch (error) {
        console.error('Erro ao criar registro:', error);
        return false;
    }
}

async function atualizarRegistroLucroReal(pedido, registroExistente) {
    try {
        const { venda, frete, comissao, impostoFederal } = calcularValores(pedido);
        const custoAtual = registroExistente.custo || 0;
        const lucroReal = venda - custoAtual - frete - comissao - impostoFederal;
        const margemLiquida = venda ? lucroReal / venda : 0;

        const numeroNF = pedido.nf && pedido.nf.trim() !== '' ? pedido.nf : '-';

        const updates = {
            nf: numeroNF,
            vendedor: pedido.vendedor || pedido.responsavel || '',
            venda: venda,
            frete: frete,
            comissao: comissao,
            imposto_federal: impostoFederal,
            lucro_real: lucroReal,
            margem_liquida: margemLiquida,
            data_emissao: pedido.data_emissao || registroExistente.data_emissao
        };

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
            console.error('Erro ao atualizar registro:', erro);
            return false;
        }

        console.log(`🔄 Registro atualizado para pedido ${pedido.codigo} (NF: ${numeroNF})`);
        return true;
    } catch (error) {
        console.error('Erro ao atualizar registro:', error);
        return false;
    }
}

async function processarPedido(pedido) {
    console.log(`Processando pedido ${pedido.codigo} (NF: ${pedido.nf})`);
    const existente = await obterRegistroExistente(pedido.codigo);
    if (existente) {
        return await atualizarRegistroLucroReal(pedido, existente);
    } else {
        return await criarRegistroLucroReal(pedido);
    }
}

// ==============================
// MONITORAMENTO CONTÍNUO (rápido)
// ==============================
async function verificarPedidosRecentes() {
    console.log(`🔍 [${new Date().toLocaleTimeString()}] Verificando pedidos emitidos recentes...`);
    try {
        // Busca pedidos emitidos nos últimos 5 minutos
        const cincoMinutosAtras = new Date(Date.now() - 5 * 60 * 1000).toISOString();
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*&status=eq.emitida&updated_at=gte.${cincoMinutosAtras}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );

        if (!response.ok) {
            console.error('Erro ao buscar pedidos:', response.status, await response.text());
            return;
        }

        const pedidos = await response.json();
        if (pedidos.length === 0) {
            console.log('📭 Nenhum pedido recente encontrado');
            return;
        }

        console.log(`📦 ${pedidos.length} pedido(s) recente(s) encontrado(s)`);
        for (const pedido of pedidos) {
            await processarPedido(pedido);
        }
    } catch (error) {
        console.error('❌ Erro no monitoramento:', error);
    }
}

// ==============================
// CARGA COMPLETA
// ==============================
async function cargaCompleta() {
    console.log('🔄 Iniciando carga completa de todos os pedidos emitidos...');
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*&status=eq.emitida`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );

        if (!response.ok) {
            console.error('❌ Erro na carga completa:', response.status, await response.text());
            return;
        }

        const pedidos = await response.json();
        console.log(`📦 Encontrados ${pedidos.length} pedidos emitidos no total`);

        let processados = 0;
        for (const pedido of pedidos) {
            const sucesso = await processarPedido(pedido);
            if (sucesso) processados++;
        }
        console.log(`✅ Carga completa: ${processados} registros sincronizados`);
    } catch (error) {
        console.error('❌ Erro na carga completa:', error);
    }
}

// ==============================
// ROTA DE DEBUG
// ==============================
app.get('/api/debug/pedidos', async (req, res) => {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=codigo,nf,documento,status,updated_at&status=eq.emitida&order=updated_at.desc&limit=20`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// ROTAS PARA DISPARO MANUAL
// ==============================
app.get('/api/carga-inicial', async (req, res) => {
    await cargaCompleta();
    res.json({ success: true, message: 'Carga completa executada' });
});

app.get('/api/monitorar-pedidos', async (req, res) => {
    await verificarPedidosRecentes();
    res.json({ success: true, message: 'Monitoramento rápido executado' });
});

// ==============================
// ROTAS PROTEGIDAS – LUCRO REAL
// ==============================
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
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`
            }
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

app.patch('/api/lucro-real/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        const getResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
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

// ==============================
// INICIAR MONITORAMENTO
// ==============================
// Faz uma carga completa ao iniciar
setTimeout(() => {
    console.log('⏳ Executando carga inicial...');
    cargaCompleta();
}, 5000);

// Monitoramento rápido a cada 30 segundos
setInterval(verificarPedidosRecentes, 30 * 1000);

// Também uma varredura completa a cada 1 hora
setInterval(cargaCompleta, 60 * 60 * 1000);

// ==============================
// SERVIR FRONTEND
// ==============================
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==============================
// INICIAR SERVIDOR
// ==============================
app.listen(PORT, () => {
    console.log(`🚀 Servidor Lucro Real rodando na porta ${PORT}`);
    console.log('🔒 Autenticação centralizada no Portal');
    console.log('📦 Supabase conectado');
    console.log('💰 Monitorando pedidos_faturamento (a cada 30s)');
    console.log('🔄 Carga completa a cada 1 hora');
    console.log('🔍 Rota de debug: /api/debug/pedidos');
});
