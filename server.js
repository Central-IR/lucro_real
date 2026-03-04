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
    const publicPaths = ['/', '/api/health'];

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
// ROTAS PROTEGIDAS – LUCRO REAL
// ==============================

// GET /api/lucro-real - listar registros do mês/ano
app.get('/api/lucro-real', verificarAutenticacao, async (req, res) => {
    try {
        const { mes, ano } = req.query;
        
        let supabaseUrl;
        
        if (mes !== undefined && ano !== undefined) {
            const month = parseInt(mes); // 0-based (Janeiro = 0)
            const year = parseInt(ano);
            const startDate = new Date(year, month, 1);
            const endDate = new Date(year, month + 1, 0);
            const startStr = startDate.toISOString().split('T')[0];
            const endStr = endDate.toISOString().split('T')[0];
            
            supabaseUrl = `${SUPABASE_URL}/rest/v1/lucro_real?select=*&data_emissao=gte.${startStr}&data_emissao=lte.${endStr}&order=data_emissao.asc`;
        } else if (ano !== undefined) {
            // Buscar ano inteiro para relatório
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
            console.error('❌ Erro Supabase (lucro_real):', errorText);
            throw new Error(`Supabase erro ${response.status}`);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao buscar lucro real:', error.message);
        res.status(500).json({ error: 'Erro ao buscar lucro real', details: error.message });
    }
});

// POST /api/lucro-real - criar novo registro
app.post('/api/lucro-real', verificarAutenticacao, async (req, res) => {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real`, {
            method: 'POST',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify(req.body)
        });

        if (!response.ok) {
            const err = await response.text();
            throw new Error(err);
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('❌ Erro ao criar lucro real:', error.message);
        res.status(500).json({ error: 'Erro ao criar lucro real', details: error.message });
    }
});

// PATCH /api/lucro-real/:codigo - atualizar
app.patch('/api/lucro-real/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`, {
            method: 'PATCH',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=representation'
            },
            body: JSON.stringify(req.body)
        });

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

// DELETE /api/lucro-real/:codigo - remover
app.delete('/api/lucro-real/:codigo', verificarAutenticacao, async (req, res) => {
    try {
        const response = await fetch(`${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${req.params.codigo}`, {
            method: 'DELETE',
            headers: {
                apikey: SUPABASE_KEY,
                Authorization: `Bearer ${SUPABASE_KEY}`
            }
        });

        if (!response.ok) {
            throw new Error('Erro ao excluir lucro real');
        }

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Erro ao excluir lucro real' });
    }
});

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
    console.log('💰 Tabela: lucro_real');
});
