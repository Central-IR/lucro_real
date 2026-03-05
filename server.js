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
    const publicPaths = ['/', '/api/health', '/api/monitorar-pedidos'];

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
    // Remove 'R$', pontos de milhar e substitui vírgula por ponto
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
    const lucroReal = venda - (pedido.custo || 0) - frete - comissao - impostoFederal;
    const margemLiquida = venda ? lucroReal / venda : 0;

    return {
        venda,
        frete,
        comissao,
        impostoFederal,
        lucroReal,
        margemLiquida
    };
}

// ==============================
// MONITORAMENTO DE PEDIDOS EMITIDOS
// ==============================

// Função para verificar se um pedido já existe no lucro_real
async function pedidoJaProcessado(codigo) {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${codigo}&select=id`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );
        const data = await response.json();
        return data.length > 0;
    } catch (error) {
        console.error('Erro ao verificar pedido processado:', error);
        return false;
    }
}

// Função para criar registro no lucro_real
async function criarRegistroLucroReal(pedido) {
    try {
        const { venda, frete, comissao, impostoFederal, lucroReal, margemLiquida } = calcularValores(pedido);

        const registro = {
            codigo: pedido.codigo,
            vendedor: pedido.vendedor || pedido.responsavel || '',
            venda: venda,
            custo: 0, // Valor inicial, será editável depois
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

        console.log(`✅ Registro criado para pedido ${pedido.codigo}`);
        return true;
    } catch (error) {
        console.error('Erro ao criar registro:', error);
        return false;
    }
}

// Função para processar um pedido emitido
async function processarPedidoEmitido(pedido) {
    // Verificar se já foi processado
    const jaProcessado = await pedidoJaProcessado(pedido.codigo);
    if (jaProcessado) {
        console.log(`⏭️ Pedido ${pedido.codigo} já processado, ignorando`);
        return;
    }

    // Criar registro
    await criarRegistroLucroReal(pedido);
}

// Função principal de monitoramento
async function monitorarPedidosEmitidos() {
    console.log(`🔍 [${new Date().toLocaleTimeString()}] Verificando novos pedidos emitidos...`);
    
    try {
        // Buscar pedidos emitidos nos últimos 10 minutos
        const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*&status=eq.emitida&updated_at=gte.${dezMinutosAtras}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );

        if (!response.ok) {
            console.error('Erro ao buscar pedidos emitidos');
            return;
        }

        const pedidos = await response.json();
        
        if (pedidos.length === 0) {
            console.log('📭 Nenhum novo pedido encontrado');
            return;
        }

        console.log(`📦 ${pedidos.length} novo(s) pedido(s) encontrado(s)`);
        
        for (const pedido of pedidos) {
            await processarPedidoEmitido(pedido);
        }
    } catch (error) {
        console.error('❌ Erro no monitoramento:', error);
    }
}

// ==============================
// ROTA PARA EXECUTAR MONITORAMENTO MANUALMENTE
// ==============================
app.get('/api/monitorar-pedidos', async (req, res) => {
    await monitorarPedidosEmitidos();
    res.json({ success: true, message: 'Monitoramento executado' });
});

// ==============================
// ROTAS PROTEGIDAS – LUCRO REAL
// ==============================

// GET /api/lucro-real - listar registros do mês/ano
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

// PATCH /api/lucro-real/:codigo - atualizar (custo, comissão, imposto)
app.patch('/api/lucro-real/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        // Buscar o registro atual para recalcular lucro_real e margem
        const getResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );

        if (!getResponse.ok) {
            throw new Error('Erro ao buscar registro');
        }

        const registros = await getResponse.json();
        if (registros.length === 0) {
            return res.status(404).json({ error: 'Registro não encontrado' });
        }

        const registro = registros[0];
        
        // Atualizar apenas os campos permitidos
        const updates = {};
        if (req.body.custo !== undefined) updates.custo = req.body.custo;
        if (req.body.comissao !== undefined) updates.comissao = req.body.comissao;
        if (req.body.imposto_federal !== undefined) updates.imposto_federal = req.body.imposto_federal;

        // Recalcular lucro_real e margem_liquida
        const novoCusto = updates.custo !== undefined ? updates.custo : registro.custo;
        const novaComissao = updates.comissao !== undefined ? updates.comissao : registro.comissao;
        novoImposto = updates.imposto_federal !== undefined ? updates.imposto_federal : registro.imposto_federal;

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
            throw new Error('Erro ao atualizar lucro real');
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar lucro real' });
    }
});

// ==============================
// INICIAR MONITORAMENTO AUTOMÁTICO
// ==============================
// Executar a cada 2 minutos
setInterval(monitorarPedidosEmitidos, 2 * 60 * 1000);

// Executar primeira vez após 10 segundos
setTimeout(monitorarPedidosEmitidos, 10000);

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
    console.log('📦 Supabase conectado com Service Role');
    console.log('💰 Monitorando tabela: pedidos_faturamento');
    console.log('📊 Alimentando tabela: lucro_real');
    console.log('⏱️  Monitoramento a cada 2 minutos');
});
