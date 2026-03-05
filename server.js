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

console.log('SUPABASE_URL:', SUPABASE_URL);
console.log('SUPABASE_KEY:', SUPABASE_KEY ? '****' : 'missing');

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('❌ ERRO: Variáveis de ambiente não configuradas');
  process.exit(1);
}

// Função para testar a conexão com Supabase
async function testConnection() {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=codigo&limit=1`, {
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${SUPABASE_KEY}`
      }
    });
    if (response.ok) {
      const data = await response.json();
      console.log('✅ Conexão com Supabase OK. Exemplo:', data);
    } else {
      console.error('❌ Falha na conexão:', response.status, await response.text());
    }
  } catch (error) {
    console.error('❌ Erro na conexão:', error.message);
  }
}
testConnection();

// Funções auxiliares
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
  const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${codigo}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const data = await response.json();
  return data[0] || null;
}

async function criarRegistroLucroReal(pedido) {
  try {
    console.log(`Criando registro para pedido ${pedido.codigo}`);
    const { venda, frete, comissao, impostoFederal } = calcularValores(pedido);
    const lucroReal = venda - frete - comissao - impostoFederal;
    const margemLiquida = venda ? lucroReal / venda : 0;
    const numeroNF = pedido.nf && pedido.nf.trim() !== '' ? pedido.nf : '-';
    let dataEmissao = pedido.data_emissao || pedido.data_registro;
    if (dataEmissao) dataEmissao = dataEmissao.split('T')[0];
    else dataEmissao = new Date().toISOString().split('T')[0];

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

async function atualizarRegistroLucroReal(pedido, existente) {
  try {
    console.log(`Atualizando registro para pedido ${pedido.codigo}`);
    const { venda, frete, comissao, impostoFederal } = calcularValores(pedido);
    const custoAtual = existente.custo || 0;
    const lucroReal = venda - custoAtual - frete - comissao - impostoFederal;
    const margemLiquida = venda ? lucroReal / venda : 0;
    const numeroNF = pedido.nf && pedido.nf.trim() !== '' ? pedido.nf : '-';
    let dataEmissao = pedido.data_emissao || pedido.data_registro;
    if (dataEmissao) dataEmissao = dataEmissao.split('T')[0];
    else dataEmissao = existente.data_emissao;

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

    const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${pedido.codigo}`, {
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
  console.log(`Processando pedido ${pedido.codigo}`);
  const existente = await obterRegistroExistente(pedido.codigo);
  if (existente) {
    return await atualizarRegistroLucroReal(pedido, existente);
  } else {
    return await criarRegistroLucroReal(pedido);
  }
}

// CARGA COMPLETA - chamada imediatamente
async function cargaCompleta() {
  console.log('🔄 Iniciando carga completa de todos os pedidos...');
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=*&order=codigo.asc`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (!response.ok) {
      console.error('❌ Erro na carga completa:', response.status, await response.text());
      return;
    }
    const pedidos = await response.json();
    console.log(`📦 Encontrados ${pedidos.length} pedidos no total`);
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

// Executa a carga completa imediatamente
cargaCompleta();

// Rotas de debug
app.get('/api/debug/pedidos', async (req, res) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=codigo,nf,documento,status,updated_at,data_emissao,data_registro&order=updated_at.desc&limit=20`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const data = await response.json();
  res.json(data);
});

app.get('/api/debug/lucro-real', async (req, res) => {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?select=*&order=created_at.desc&limit=20`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
  });
  const data = await response.json();
  res.json(data);
});

app.get('/api/test/supabase', async (req, res) => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/pedidos_faturamento?select=codigo&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    if (response.ok) {
      const data = await response.json();
      res.json({ success: true, data });
    } else {
      res.status(500).json({ success: false, error: await response.text() });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Rota pública
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Servir frontend
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta ${PORT}`);
});
