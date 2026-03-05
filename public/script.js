// ==============================
// MONITORAMENTO DE PEDIDOS EMITIDOS
// ==============================

// Função para verificar novos pedidos emitidos
async function verificarNovosPedidosEmitidos() {
    try {
        // Buscar pedidos emitidos nos últimos 5 minutos que ainda não foram processados
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
            console.error('Erro ao buscar pedidos emitidos');
            return;
        }

        const pedidos = await response.json();
        
        for (const pedido of pedidos) {
            // Verificar se já existe na tabela lucro_real
            const existeResponse = await fetch(
                `${SUPABASE_URL}/rest/v1/lucro_real?codigo=eq.${pedido.codigo}`,
                {
                    headers: {
                        apikey: SUPABASE_KEY,
                        Authorization: `Bearer ${SUPABASE_KEY}`
                    }
                }
            );
            
            const existe = await existeResponse.json();
            
            // Se não existir, criar registro
            if (existe.length === 0) {
                await criarRegistroLucroReal(pedido);
            }
        }
    } catch (error) {
        console.error('Erro no monitoramento:', error);
    }
}

// Função para criar registro no lucro_real
async function criarRegistroLucroReal(pedido) {
    // Extrair valores
    const venda = parseFloat(pedido.valor_total?.replace('R$', '').replace(/\./g, '').replace(',', '.')) || 0;
   
