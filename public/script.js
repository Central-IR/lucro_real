// ============================================
// CONFIGURAÇÃO
// ============================================
const PORTAL_URL = 'https://ir-comercio-portal-zcan.onrender.com';
const API_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'http://localhost:3004/api'
    : `${window.location.origin}/api`;

let lucroData = [];
let isOnline = false;
let sessionToken = null;
let currentMonth = new Date();
let lastDataHash = '';
let currentFetchController = null;

let relatorioAno = new Date().getFullYear();
let relatorioPagina = 1;
const mesesPorPagina = 3;

let calendarYear = new Date().getFullYear();

let custoFixoMensal = 0; // Valor do custo fixo do mês

// ============================================
// INICIALIZAÇÃO E AUTENTICAÇÃO
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    verificarAutenticacao();
});

async function verificarAutenticacao() {
    const urlParams = new URLSearchParams(window.location.search);
    const tokenFromUrl = urlParams.get('sessionToken');

    if (tokenFromUrl) {
        sessionToken = tokenFromUrl;
        sessionStorage.setItem('lucroSession', tokenFromUrl);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else {
        sessionToken = sessionStorage.getItem('lucroSession');
    }

    if (!sessionToken) {
        mostrarTelaAcessoNegado();
        return;
    }

    try {
        const verifyRes = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        if (!verifyRes.ok) {
            mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU');
            return;
        }
        const sessionData = await verifyRes.json();
        if (!sessionData.valid) {
            mostrarTelaAcessoNegado('SESSÃO INVÁLIDA');
            return;
        }
    } catch (e) {
        console.warn('Falha ao verificar sessão, usando cache', e);
    }
    inicializarApp();
}

function mostrarTelaAcessoNegado(mensagem = 'NÃO AUTORIZADO') {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; background: var(--bg-primary); color: var(--text-primary); text-align: center; padding: 2rem;">
            <h1 style="font-size: 2.2rem; margin-bottom: 1rem;">${mensagem}</h1>
            <p style="color: var(--text-secondary); margin-bottom: 2rem;">Somente usuários autenticados podem acessar esta área.</p>
            <a href="${PORTAL_URL}" style="display: inline-block; background: var(--btn-register); color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">IR PARA O PORTAL</a>
        </div>
    `;
}

function inicializarApp() {
    updateMonthDisplay();
    loadLucroReal();
    setInterval(() => { if (isOnline) loadLucroReal(); }, 30000);
}

// ============================================
// CONEXÃO COM A API
// ============================================
function updateConnectionStatus() {
    const status = document.getElementById('connectionStatus');
    if (status) {
        status.className = isOnline ? 'connection-status online' : 'connection-status offline';
    }
}

async function syncData() {
    const btnSync = document.getElementById('btnSync');
    if (btnSync) {
        btnSync.classList.add('syncing');
        btnSync.disabled = true;
    }
    try {
        await fetch(`${API_URL}/monitorar-pedidos`, {
            headers: { 'X-Session-Token': sessionToken }
        });
        await loadLucroReal();
        showMessage('DADOS SINCRONIZADOS', 'success');
    } catch (error) {
        showMessage('ERRO AO SINCRONIZAR', 'error');
    } finally {
        if (btnSync) {
            btnSync.classList.remove('syncing');
            btnSync.disabled = false;
        }
    }
}

// ============================================
// CARREGAR LUCRO REAL E CUSTO FIXO
// ============================================
async function loadLucroReal() {
    if (currentFetchController) currentFetchController.abort();
    currentFetchController = new AbortController();
    const signal = currentFetchController.signal;
    const mes = currentMonth.getMonth();
    const ano = currentMonth.getFullYear();

    try {
        const response = await fetch(`${API_URL}/lucro-real?mes=${mes}&ano=${ano}`, {
            headers: { 'X-Session-Token': sessionToken },
            cache: 'no-cache',
            signal
        });

        if (response.status === 401) {
            sessionStorage.removeItem('lucroSession');
            mostrarTelaAcessoNegado('SUA SESSÃO EXPIROU');
            return;
        }
        if (!response.ok) {
            isOnline = false;
            updateConnectionStatus();
            setTimeout(() => loadLucroReal(), 5000);
            return;
        }

        const data = await response.json();
        if (mes !== currentMonth.getMonth() || ano !== currentMonth.getFullYear()) return;

        lucroData = data;
        isOnline = true;
        updateConnectionStatus();
        lastDataHash = JSON.stringify(lucroData.map(r => r.id));
        currentFetchController = null;

        // Carrega o custo fixo do mês
        await loadCustoFixoMensal(mes, ano);
        updateDisplay();
    } catch (error) {
        if (error.name === 'AbortError') return;
        isOnline = false;
        updateConnectionStatus();
        setTimeout(() => loadLucroReal(), 5000);
    }
}

// Carregar custo fixo do mês
async function loadCustoFixoMensal(mes, ano) {
    try {
        const response = await fetch(`${API_URL}/custo-fixo?mes=${mes}&ano=${ano}`, {
            headers: { 'X-Session-Token': sessionToken }
        });
        if (response.ok) {
            const data = await response.json();
            custoFixoMensal = data.valor || 0;
        } else {
            custoFixoMensal = 0;
        }
    } catch (error) {
        console.warn('Erro ao carregar custo fixo', error);
        custoFixoMensal = 0;
    }
}

// Salvar custo fixo
async function saveCustoFixo() {
    const valor = parseFloat(document.getElementById('custoFixoInput').value) || 0;
    const mes = currentMonth.getMonth();
    const ano = currentMonth.getFullYear();

    try {
        const response = await fetch(`${API_URL}/custo-fixo`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({ mes, ano, valor })
        });
        if (response.ok) {
            custoFixoMensal = valor;
            updateDashboard();
            closeCustoFixoModal();
            showMessage('CUSTO FIXO ATUALIZADO', 'success');
        } else {
            throw new Error('Erro ao salvar');
        }
    } catch (error) {
        showMessage('ERRO AO SALVAR', 'error');
    }
}

// Abrir modal de custo fixo
function abrirModalCustoFixo() {
    document.getElementById('custoFixoInput').value = custoFixoMensal;
    document.getElementById('editCustoFixoModal').classList.add('show');
}

function closeCustoFixoModal() {
    document.getElementById('editCustoFixoModal').classList.remove('show');
}

// ============================================
// NAVEGAÇÃO DE MESES
// ============================================
function changeMonth(direction) {
    if (currentFetchController) currentFetchController.abort();
    currentMonth.setMonth(currentMonth.getMonth() + direction);
    lucroData = [];
    lastDataHash = '';
    updateMonthDisplay();
    updateTable();
    loadLucroReal();
}

function updateMonthDisplay() {
    const months = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
    const monthName = months[currentMonth.getMonth()];
    const year = currentMonth.getFullYear();
    document.getElementById('currentMonth').textContent = `${monthName} ${year}`;
}

// ============================================
// ATUALIZAR DISPLAY
// ============================================
function updateDisplay() {
    updateMonthDisplay();
    updateDashboard();
    updateTable();
    updateVendedoresFilter();
}

function updateDashboard() {
    let totalVenda = 0, totalCusto = 0, totalFrete = 0, totalComissao = 0, totalImposto = 0;
    let totalLucroBruto = 0; // Soma do lucro de cada venda (LUCRO BRUTO)

    lucroData.forEach(r => {
        totalVenda += r.venda || 0;
        totalCusto += r.custo || 0;
        totalFrete += r.frete || 0;
        totalComissao += r.comissao || 0;
        totalImposto += r.imposto_federal || 0;

        const lucro = (r.venda || 0) - (r.custo || 0) - (r.frete || 0) - (r.comissao || 0) - (r.imposto_federal || 0);
        totalLucroBruto += lucro;
    });

    // Atualiza cards fixos
    document.getElementById('totalVenda').innerHTML = `<span class="stat-value-success">${formatarMoeda(totalVenda)}</span>`;
    document.getElementById('totalCusto').innerHTML = `<span style="color: #EF4444; font-weight: 700;">${formatarMoeda(totalCusto)}</span>`;
    document.getElementById('totalFrete').innerHTML = `<span style="color: #3B82F6; font-weight: 700;">${formatarMoeda(totalFrete)}</span>`;
    document.getElementById('totalImposto').innerHTML = `<span style="color: #EF4444;">${formatarMoeda(totalImposto)}</span>`;

    // LUCRO BRUTO - agora sem cor especial (padrão preto)
    const lucroBrutoElement = document.getElementById('totalLucroBruto');
    lucroBrutoElement.innerHTML = formatarMoeda(totalLucroBruto);
    lucroBrutoElement.className = 'stat-value'; // remove qualquer classe de cor

    // COMISSÃO - aplica classe amarela
    const comissaoElement = document.getElementById('totalComissao');
    comissaoElement.innerHTML = formatarMoeda(totalComissao);
    comissaoElement.className = 'stat-value stat-value-commission';

    // LUCRO REAL = LUCRO BRUTO - CUSTO FIXO MENSAL
    const lucroRealCalculado = totalLucroBruto - custoFixoMensal;
    const lucroRealElement = document.getElementById('totalLucroReal');
    const iconLucroReal = document.getElementById('iconLucroReal');

    lucroRealElement.innerHTML = formatarMoeda(lucroRealCalculado);
    lucroRealElement.className = 'stat-value';
    iconLucroReal.className = 'stat-icon';

    if (lucroRealCalculado >= 0) {
        lucroRealElement.classList.add('stat-value-success');
        iconLucroReal.classList.add('stat-icon-success');
    } else {
        lucroRealElement.classList.add('stat-value-danger');
        iconLucroReal.classList.add('stat-icon-danger');
    }
}

function updateVendedoresFilter() {
    const vendedores = new Set(lucroData.map(r => r.vendedor).filter(Boolean));
    const select = document.getElementById('filterVendedor');
    const current = select.value;
    select.innerHTML = '<option value="">Vendedor</option>';
    Array.from(vendedores).sort().forEach(v => {
        const option = document.createElement('option');
        option.value = v;
        option.textContent = v;
        select.appendChild(option);
    });
    select.value = current;
}

function filterLucroReal() {
    updateTable();
}

function updateTable() {
    const container = document.getElementById('lucroContainer');
    let filtered = [...lucroData];

    const search = document.getElementById('search').value.toLowerCase();
    const filterVendedor = document.getElementById('filterVendedor').value;

    if (search) {
        filtered = filtered.filter(r =>
            (r.nf || '').toLowerCase().includes(search) ||
            (r.vendedor || '').toLowerCase().includes(search)
        );
    }
    if (filterVendedor) {
        filtered = filtered.filter(r => (r.vendedor || '') === filterVendedor);
    }

    // Ordenar por NF (crescente)
    filtered.sort((a, b) => {
        const nfA = (a.nf || '').padStart(10, '0');
        const nfB = (b.nf || '').padStart(10, '0');
        return nfA.localeCompare(nfB);
    });

    if (filtered.length === 0) {
        container.innerHTML = '<tr><td colspan="9" style="text-align:center;padding:2rem;">Nenhum registro encontrado</td></tr>';
        return;
    }

    let lastMonthYear = null;
    let html = '';

    filtered.forEach(r => {
        const data = new Date(r.data_emissao + 'T00:00:00');
        const mesAno = `${data.getMonth()+1}/${data.getFullYear()}`;
        if (mesAno !== lastMonthYear) {
            if (lastMonthYear !== null) {
                const monthNames = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
                const nomeMes = monthNames[data.getMonth()];
                html += `<tr class="month-separator"><td colspan="9" style="background: var(--th-bg); color: var(--th-color); font-weight: bold; padding: 8px; text-align: center;">${nomeMes} ${data.getFullYear()}</td></tr>`;
            }
            lastMonthYear = mesAno;
        }

        const lucroReal = (r.venda || 0) - (r.custo || 0) - (r.frete || 0) - (r.comissao || 0) - (r.imposto_federal || 0);
        const margem = r.venda ? (lucroReal / r.venda) * 100 : 0;
        const lucroClass = lucroReal >= 0 ? 'stat-value-success' : 'stat-value-danger';
        
        html += `
        <tr onclick="abrirEditModal('${r.codigo}')">
            <td>${(r.nf || '-').toUpperCase()}</td>
            <td>${(r.vendedor || '-').toUpperCase()}</td>
            <td>${formatarMoeda(r.venda)}</td>
            <td style="color: #EF4444; font-weight: 700;">${formatarMoeda(r.custo)}</td>
            <td>${formatarMoeda(r.frete)}</td>
            <td>${formatarMoeda(r.comissao)}</td>
            <td style="color: #EF4444; font-weight: 700;">${formatarMoeda(r.imposto_federal)}</td>
            <td style="font-weight: 700;" class="${lucroClass}">${formatarMoeda(lucroReal)}</td>
            <td>${margem.toFixed(2)}%</td>
        </tr>`;
    });

    container.innerHTML = html;
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================
function formatarMoeda(valor) {
    if (valor === null || valor === undefined) return 'R$ 0,00';
    const num = parseFloat(valor);
    return 'R$ ' + num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function showMessage(message, type = 'success') {
    const div = document.createElement('div');
    div.className = `floating-message ${type}`;
    div.textContent = message;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.animation = 'slideOut 0.3s ease forwards';
        setTimeout(() => div.remove(), 300);
    }, 2000);
}

// ============================================
// MODAL DE EDIÇÃO (CUSTO, COMISSÃO, IMPOSTO)
// ============================================
let currentEditCodigo = null;

function abrirEditModal(codigo) {
    const registro = lucroData.find(r => r.codigo === codigo);
    if (!registro) return;

    currentEditCodigo = codigo;
    document.getElementById('editNF').textContent = registro.nf || '-';

    document.getElementById('editCusto').value = registro.custo || 0;
    document.getElementById('editComissao').value = registro.comissao || 0;
    document.getElementById('editImposto').value = registro.imposto_federal || 0;

    // Adiciona listeners para tecla Enter nos inputs
    const inputs = ['editCusto', 'editComissao', 'editImposto'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keydown', handleEnterKey);
        }
    });

    document.getElementById('editModal').classList.add('show');
}

function handleEnterKey(event) {
    if (event.key === 'Enter') {
        event.preventDefault();
        saveEditModal();
    }
}

function closeEditModal() {
    const inputs = ['editCusto', 'editComissao', 'editImposto'];
    inputs.forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.removeEventListener('keydown', handleEnterKey);
        }
    });

    document.getElementById('editModal').classList.remove('show');
    currentEditCodigo = null;
}

async function saveEditModal() {
    if (!currentEditCodigo) return;

    const novoCusto = parseFloat(document.getElementById('editCusto').value) || 0;
    const novaComissao = parseFloat(document.getElementById('editComissao').value) || 0;
    const novoImposto = parseFloat(document.getElementById('editImposto').value) || 0;

    try {
        const response = await fetch(`${API_URL}/lucro-real/${currentEditCodigo}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'X-Session-Token': sessionToken
            },
            body: JSON.stringify({
                custo: novoCusto,
                comissao: novaComissao,
                imposto_federal: novoImposto
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Erro ao salvar');
        }

        const registro = lucroData.find(r => r.codigo === currentEditCodigo);
        if (registro) {
            registro.custo = novoCusto;
            registro.comissao = novaComissao;
            registro.imposto_federal = novoImposto;
        }

        updateTable();
        updateDashboard();
        closeEditModal();
        showMessage('VALORES ATUALIZADOS', 'success');
    } catch (error) {
        console.error(error);
        showMessage('ERRO AO SALVAR: ' + error.message, 'error');
    }
}

// ============================================
// RELATÓRIO ANUAL
// ============================================
function openRelatorioAnualModal() {
    relatorioAno = new Date().getFullYear();
    relatorioPagina = 1;
    renderRelatorio();
    document.getElementById('relatorioModal').classList.add('show');
}

function closeRelatorioModal() {
    document.getElementById('relatorioModal').classList.remove('show');
}

function changeRelatorioYear(direction) {
    relatorioAno += direction;
    relatorioPagina = 1;
    renderRelatorio();
}

function changeRelatorioPagina(direction) {
    relatorioPagina += direction;
    renderRelatorio();
}

async function renderRelatorio() {
    document.getElementById('relatorioAnoTitulo').textContent = relatorioAno;

    try {
        const response = await fetch(`${API_URL}/lucro-real?ano=${relatorioAno}`, {
            headers: { 'X-Session-Token': sessionToken }
        });
        if (!response.ok) throw new Error();
        const dadosAno = await response.json();

        const meses = Array(12).fill().map(() => ({
            freteTotal: 0,
            vendaTotal: 0,
            lucroBruto: 0,        // soma do lucro de cada venda (venda - custo - frete - comissão - imposto)
            custoTotal: 0,
            impostoTotal: 0,
            custoFixoMensal: 0
        }));

        // Agrupar por mês
        dadosAno.forEach(r => {
            const data = new Date(r.data_emissao + 'T00:00:00');
            const mes = data.getMonth();
            const venda = r.venda || 0;
            const lucro = (venda - (r.custo || 0) - (r.frete || 0) - (r.comissao || 0) - (r.imposto_federal || 0));
            meses[mes].freteTotal += r.frete || 0;
            meses[mes].vendaTotal += venda;
            meses[mes].lucroBruto += lucro;
            meses[mes].custoTotal += r.custo || 0;
            meses[mes].impostoTotal += r.imposto_federal || 0;
            // Captura o custo fixo (considera que todas as linhas do mês têm o mesmo valor)
            if (r.custo_fixo_mensal !== undefined && meses[mes].custoFixoMensal === 0) {
                meses[mes].custoFixoMensal = parseFloat(r.custo_fixo_mensal) || 0;
            }
        });

        const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 
                           'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        const totalPaginas = Math.ceil(12 / mesesPorPagina);
        const inicio = (relatorioPagina - 1) * mesesPorPagina;
        const fim = inicio + mesesPorPagina;
        const mesesPagina = mesesNomes.slice(inicio, fim);

        let html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;">';

        mesesPagina.forEach((nome, idx) => {
            const mesIndex = inicio + idx;
            const m = meses[mesIndex];
            const percentualFrete = m.vendaTotal ? ((m.freteTotal / m.vendaTotal) * 100).toFixed(2) : '0.00';
            const lucroReal = m.lucroBruto - m.custoFixoMensal;
            const lucroRealClass = lucroReal >= 0 ? 'stat-value-success' : 'stat-value-danger';
            
            // Tendência baseada no Lucro Bruto (ou pode ser no Lucro Real, tanto faz)
            let tendencia = '';
            if (mesIndex > 0) {
                const mesAnt = meses[mesIndex - 1];
                const lucroBrutoAnt = mesAnt.lucroBruto;
                if (m.lucroBruto > lucroBrutoAnt) {
                    tendencia = '<span style="color:#22C55E; font-weight:bold; margin-left:0.5rem;">▲</span>';
                } else if (m.lucroBruto < lucroBrutoAnt) {
                    tendencia = '<span style="color:#EF4444; font-weight:bold; margin-left:0.5rem;">▼</span>';
                }
            }

            html += `
                <div style="padding: 1rem; background: var(--bg-card); border: 1px solid rgba(107,114,128,0.2); border-radius: 8px; position: relative;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h4 style="margin:0 0 0.5rem 0; color: var(--text-primary);">${nome}</h4>
                        ${tendencia}
                    </div>
                    <div style="margin-bottom:0.5rem;">
                        <span style="font-weight: 700;">Frete:</span> 
                        <span style="color: #3B82F6;">${percentualFrete}%</span>
                    </div>
                    <div style="margin-bottom:0.5rem;">
                        <span style="font-weight: 700;">Lucro Bruto:</span> 
                        ${formatarMoeda(m.lucroBruto)}
                    </div>
                    <div style="margin-bottom:0.5rem;">
                        <span style="font-weight: 700;">Custo:</span> 
                        ${formatarMoeda(m.custoTotal)}
                    </div>
                    <div style="margin-bottom:0.5rem;">
                        <span style="font-weight: 700;">Lucro Real:</span> 
                        <span class="${lucroRealClass}">${formatarMoeda(lucroReal)}</span>
                    </div>
                    <div>
                        <span style="font-weight: 700;">Custo Fixo:</span> 
                        ${formatarMoeda(m.custoFixoMensal)}
                    </div>
                </div>
            `;
        });

        html += '</div>';

        // Restante do código (paginação e cards anuais) permanece igual
        html += `
            <div style="display: flex; justify-content: center; gap: 1rem; margin-bottom: 1.5rem;">
                <button onclick="changeRelatorioPagina(-1)" ${relatorioPagina === 1 ? 'disabled' : ''} 
                        style="background: transparent; border: 1px solid var(--border-color); padding: 0.5rem 1rem; border-radius: 6px; color: var(--text-secondary);">‹</button>
                <span style="font-weight: 600;">${relatorioPagina}</span>
                <button onclick="changeRelatorioPagina(1)" ${relatorioPagina === totalPaginas ? 'disabled' : ''}
                        style="background: transparent; border: 1px solid var(--border-color); padding: 0.5rem 1rem; border-radius: 6px; color: var(--text-secondary);">›</button>
            </div>
        `;

        // Totais anuais
        const totalFreteAno = meses.reduce((acc, m) => acc + m.freteTotal, 0);
        const totalImpostoAno = meses.reduce((acc, m) => acc + m.impostoTotal, 0);
        const lucroRealAnual = meses.reduce((acc, m) => acc + (m.lucroBruto - m.custoFixoMensal), 0);
        const lucroRealAnualClass = lucroRealAnual >= 0 ? 'stat-value-success' : 'stat-value-danger';

        html += `
            <div style="display: flex; gap: 1rem; justify-content: center; margin: 2rem 0 0; flex-wrap: wrap;">
                <div class="stat-card" style="flex:1; min-width:150px;">
                    <div class="stat-icon stat-icon-default" style="background:rgba(107,114,128,0.1);">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                        </svg>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value" style="color:#3B82F6;">${formatarMoeda(totalFreteAno)}</div>
                        <div class="stat-label">TOTAL FRETE</div>
                    </div>
                </div>
                <div class="stat-card" style="flex:1; min-width:150px;">
                    <div class="stat-icon stat-icon-default">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M3 10h18M3 14h18" />
                        </svg>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value">${formatarMoeda(totalImpostoAno)}</div>
                        <div class="stat-label">TOTAL IMPOSTO</div>
                    </div>
                </div>
                <div class="stat-card" style="flex:1; min-width:150px;">
                    <div class="stat-icon stat-icon-default">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 12H4M12 4v16" />
                        </svg>
                    </div>
                    <div class="stat-content">
                        <div class="stat-value ${lucroRealAnualClass}" style="font-weight:700;">${formatarMoeda(lucroRealAnual)}</div>
                        <div class="stat-label">LUCRO REAL DO ANO</div>
                    </div>
                </div>
            </div>
        `;

        document.getElementById('relatorioBody').innerHTML = html;
    } catch (error) {
        console.error('Erro ao carregar dados anuais', error);
        document.getElementById('relatorioBody').innerHTML = '<p style="text-align:center;">ERRO AO CARREGAR DADOS.</p>';
    }
}
