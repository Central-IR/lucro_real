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
    const publicPaths = ['/', '/api/health', '/api/monitorar-pedidos', '/api/carga-inicial', '/api/diferencas'];

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
// FUNÇÕES DE PROCESSAMENTO
// ==============================
async function buscarRegistroPorCodigo(codigo) {
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${codigo}&select=*`,
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
        console.error('Erro ao buscar registro:', error);
        return null;
    }
}

async function criarOuAtualizarRegistro(pedido) {
    try {
        const valores = calcularValores(pedido);
        const registro = {
            codigo: pedido.codigo,
            nf: pedido.documento || '-',
            vendedor: pedido.vendedor || pedido.responsavel || '',
            venda: valores.venda,
            custo: 0, // será editável depois
            frete: valores.frete,
            comissao: valores.comissao,
            imposto_federal: valores.impostoFederal,
            lucro_real: valores.lucroReal,
            margem_liquida: valores.margemLiquida,
            data_emissao: pedido.data_emissao || new Date().toISOString().split('T')[0]
        };

        // Verificar se já existe
        const existente = await buscarRegistroPorCodigo(pedido.codigo);
        let response;
        if (existente) {
            // Atualizar (manter custo manual se já existir)
            registro.custo = existente.custo; // preserva custo manual
            // Recalcular lucro_real com custo preservado
            registro.lucro_real = registro.venda - registro.custo - registro.frete - registro.comissao - registro.imposto_federal;
            registro.margem_liquida = registro.venda ? registro.lucro_real / registro.venda : 0;

            response = await fetch(
                `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${pedido.codigo}`,
                {
                    method: 'PATCH',
                    headers: {
                        apikey: SUPABASE_KEY,
                        Authorization: `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation'
                    },
                    body: JSON.stringify(registro)
                }
            );
            console.log(`🔄 Registro atualizado para pedido ${pedido.codigo} (NF: ${pedido.documento || '-'})`);
        } else {
            // Criar novo
            response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real`, {
                method: 'POST',
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify(registro)
            });
            console.log(`✅ Registro criado para pedido ${pedido.codigo} (NF: ${pedido.documento || '-'})`);
        }

        if (!response.ok) {
            const erro = await response.text();
            console.error('Erro ao salvar registro:', erro);
            return false;
        }
        return true;
    } catch (error) {
        console.error('Erro ao criar/atualizar registro:', error);
        return false;
    }
}

// ==============================
// MONITORAMENTO DE PEDIDOS (NOVOS E ATUALIZADOS)
// ==============================
async function monitorarPedidos() {
    console.log(`🔍 [${new Date().toLocaleTimeString()}] Verificando pedidos emitidos (novos e atualizações)...`);
    try {
        // Buscar pedidos com status 'emitida' que foram criados ou atualizados nos últimos 10 minutos
        const dezMinutosAtras = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*&status=eq.emitida&or=(created_at.gte.${dezMinutosAtras},updated_at.gte.${dezMinutosAtras})`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );

        if (!response.ok) {
            console.error('Erro ao buscar pedidos');
            return;
        }

        const pedidos = await response.json();
        if (pedidos.length === 0) {
            console.log('📭 Nenhum pedido novo ou atualizado encontrado');
            return;
        }

        console.log(`📦 ${pedidos.length} pedido(s) encontrado(s)`);
        for (const pedido of pedidos) {
            await criarOuAtualizarRegistro(pedido);
        }
    } catch (error) {
        console.error('❌ Erro no monitoramento:', error);
    }
}

// ==============================
// CARGA INICIAL (TODOS OS PEDIDOS EMITIDOS)
// ==============================
async function carregarTodosPedidosEmitidos() {
    console.log('🔄 Iniciando carga inicial de todos os pedidos emitidos...');
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
            console.error('❌ Erro ao buscar pedidos emitidos para carga inicial');
            return;
        }

        const pedidos = await response.json();
        console.log(`📦 Encontrados ${pedidos.length} pedidos emitidos no total`);

        let processados = 0;
        for (const pedido of pedidos) {
            const success = await criarOuAtualizarRegistro(pedido);
            if (success) processados++;
        }
        console.log(`✅ Carga inicial concluída: ${processados} registros processados`);
    } catch (error) {
        console.error('❌ Erro na carga inicial:', error);
    }
}

// ==============================
// ROTAS PARA DIFERENÇAS MENSAIS
// ==============================
app.get('/api/diferencas', async (req, res) => {
    const { mes, ano } = req.query;
    if (!mes || !ano) return res.status(400).json({ error: 'Mês e ano obrigatórios' });
    try {
        const response = await fetch(
            `${SUPABASE_URL}/rest/v1/diferencas_mensais?mes=eq.${mes}&ano=eq.${ano}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );
        const data = await response.json();
        res.json(data[0] || { valor: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/diferencas', async (req, res) => {
    const { mes, ano, valor } = req.body;
    if (!mes || !ano || valor === undefined) return res.status(400).json({ error: 'Campos incompletos' });
    try {
        const check = await fetch(
            `${SUPABASE_URL}/rest/v1/diferencas_mensais?mes=eq.${mes}&ano=eq.${ano}`,
            {
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`
                }
            }
        );
        const existente = await check.json();
        let response;
        if (existente.length > 0) {
            response = await fetch(
                `${SUPABASE_URL}/rest/v1/diferencas_mensais?mes=eq.${mes}&ano=eq.${ano}`,
                {
                    method: 'PATCH',
                    headers: {
                        apikey: SUPABASE_KEY,
                        Authorization: `Bearer ${SUPABASE_KEY}`,
                        'Content-Type': 'application/json',
                        Prefer: 'return=representation'
                    },
                    body: JSON.stringify({ valor })
                }
            );
        } else {
            response = await fetch(`${SUPABASE_URL}/rest/v1/diferencas_mensais`, {
                method: 'POST',
                headers: {
                    apikey: SUPABASE_KEY,
                    Authorization: `Bearer ${SUPABASE_KEY}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=representation'
                },
                body: JSON.stringify({ mes, ano, valor })
            });
        }
        const data = await response.json();
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ==============================
// ROTAS PARA CARGA MANUAL
// ==============================
app.get('/api/carga-inicial', async (req, res) => {
    await carregarTodosPedidosEmitidos();
    res.json({ success: true });
});

app.get('/api/monitorar-pedidos', async (req, res) => {
    await monitorarPedidos();
    res.json({ success: true });
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

        if (!response.ok) throw new Error('Erro ao atualizar lucro real');
        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao atualizar lucro real' });
    }
});

// ==============================
// INICIAR SERVIDOR
// ==============================
setTimeout(carregarTodosPedidosEmitidos, 5000);
setInterval(monitorarPedidos, 2 * 60 * 1000); // a cada 2 minutos
setTimeout(monitorarPedidos, 10000);

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor Lucro Real rodando na porta ${PORT}`);
    console.log('🔒 Autenticação centralizada no Portal');
    console.log('📦 Supabase conectado');
    console.log('💰 Monitorando pedidos_faturamento (novos e atualizações)');
    console.log('🔄 Carga inicial de TODOS os pedidos emitidos');
});
