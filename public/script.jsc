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

// Variáveis do relatório anual
let relatorioAno = new Date().getFullYear();
let relatorioPagina = 1;
const mesesPorPagina = 3;

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

    // Verificar sessão
    try {
        const verifyRes = await fetch(`${PORTAL_URL}/api/verify-session`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionToken })
        });
        if (!verifyRes.ok) {
            mostrarTelaAcessoNegado('Sua sessão expirou');
            return;
        }
        const sessionData = await verifyRes.json();
        if (!sessionData.valid) {
            mostrarTelaAcessoNegado('Sessão inválida');
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
        await loadLucroReal();
        showMessage('Dados sincronizados', 'success');
    } catch (error) {
        showMessage('Erro ao sincronizar', 'error');
    } finally {
        if (btnSync) {
            btnSync.classList.remove('syncing');
            btnSync.disabled = false;
        }
    }
}

// ============================================
// CARREGAR LUCRO REAL
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
        // Verificar se o mês ainda é o mesmo (evita race condition)
        if (mes !== currentMonth.getMonth() || ano !== currentMonth.getFullYear()) return;

        lucroData = data;
        isOnline = true;
        updateConnectionStatus();
        lastDataHash = JSON.stringify(lucroData.map(r => r.id));
        currentFetchController = null;
        updateDisplay();
    } catch (error) {
        if (error.name === 'AbortError') return;
        isOnline = false;
        updateConnectionStatus();
        setTimeout(() => loadLucroReal(), 5000);
    }
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

    lucroData.forEach(r => {
        totalVenda += r.venda || 0;
        totalCusto += r.custo || 0;
        totalFrete += r.frete || 0;
        totalComissao += r.comissao || 0;
        totalImposto += r.imposto_federal || 0;
    });

    document.getElementById('totalVenda').textContent = formatarMoeda(totalVenda);
    document.getElementById('totalCusto').textContent = formatarMoeda(totalCusto);
    document.getElementById('totalFrete').textContent = formatarMoeda(totalFrete);
    document.getElementById('totalComissao').textContent = formatarMoeda(totalComissao);
    document.getElementById('totalImposto').textContent = formatarMoeda(totalImposto);
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
            r.codigo?.toString().includes(search) ||
            (r.vendedor || '').toLowerCase().includes(search)
        );
    }
    if (filterVendedor) {
        filtered = filtered.filter(r => r.vendedor === filterVendedor);
    }

    // Ordenar por NF (código)
    filtered.sort((a, b) => (a.codigo || '').localeCompare(b.codigo || ''));

    if (filtered.length === 0) {
        container.innerHTML = '<tr><td colspan="10" style="text-align:center;padding:2rem;">Nenhum registro encontrado</td></tr>';
        return;
    }

    container.innerHTML = filtered.map(r => {
        const lucroReal = (r.venda || 0) - (r.custo || 0) - (r.frete || 0) - (r.comissao || 0) - (r.imposto_federal || 0);
        const margem = r.venda ? (lucroReal / r.venda) * 100 : 0;
        return `
        <tr ondblclick="abrirEditModal('${r.codigo}')">
            <td><strong>${r.codigo || '-'}</strong></td>
            <td>${r.vendedor || '-'}</td>
            <td>${formatarMoeda(r.venda)}</td>
            <td>${formatarMoeda(r.custo)}</td>
            <td>${formatarMoeda(r.frete)}</td>
            <td>${formatarMoeda(r.comissao)}</td>
            <td>${formatarMoeda(r.imposto_federal)}</td>
            <td><strong>${formatarMoeda(lucroReal)}</strong></td>
            <td>${margem.toFixed(2)}%</td>
            <td class="actions-cell">
                <button onclick="abrirEditModal('${r.codigo}')" class="action-btn" style="background: #ff521d;">Editar</button>
            </td>
        </tr>`;
    }).join('');
}

// ============================================
// FUNÇÕES AUXILIARES
// ============================================
function formatarMoeda(valor) {
    if (valor === null || valor === undefined) return 'R$ 0,00';
    const num = parseFloat(valor);
    return 'R$ ' + num.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

function parseMoeda(valor) {
    if (!valor) return 0;
    const cleaned = String(valor).replace(/[^\d.,-]/g, '').replace(/\.(?=\d{3}[,.])/g, '').replace(',', '.');
    return parseFloat(cleaned) || 0;
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
// MODAL DE EDIÇÃO (duplo clique)
// ============================================
let currentEditCodigo = null;

function abrirEditModal(codigo) {
    const registro = lucroData.find(r => r.codigo === codigo);
    if (!registro) return;

    currentEditCodigo = codigo;
    document.getElementById('editNF').textContent = codigo;

    // Preencher com valores atuais
    document.getElementById('editCusto').value = registro.custo || 0;
    document.getElementById('editComissao').value = registro.comissao || 0;
    document.getElementById('editImposto').value = registro.imposto_federal || 0;

    document.getElementById('editModal').classList.add('show');
}

function closeEditModal() {
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

        if (!response.ok) throw new Error('Erro ao salvar');

        // Atualizar localmente
        const registro = lucroData.find(r => r.codigo === currentEditCodigo);
        if (registro) {
            registro.custo = novoCusto;
            registro.comissao = novaComissao;
            registro.imposto_federal = novoImposto;
        }

        updateTable();
        updateDashboard();
        closeEditModal();
        showMessage('Valores atualizados', 'success');
    } catch (error) {
        console.error(error);
        showMessage('Erro ao salvar', 'error');
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

function renderRelatorio() {
    document.getElementById('relatorioAnoTitulo').textContent = `Relatório Anual ${relatorioAno}`;

    // Buscar todos os registros do ano (pode ser uma chamada à parte, mas usaremos os dados já carregados se possível)
    // Para simplificar, vamos filtrar lucroData (já carregado) e também precisaríamos de dados de outros meses.
    // Idealmente, faria uma requisição para /api/lucro-real?ano=... mas vamos manter simples e assumir que todos os meses estão carregados? Não, então faremos uma nova requisição.
    carregarDadosAnuais();
}

async function carregarDadosAnuais() {
    try {
        const response = await fetch(`${API_URL}/lucro-real?ano=${relatorioAno}`, {
            headers: { 'X-Session-Token': sessionToken }
        });
        if (!response.ok) throw new Error();
        const dadosAno = await response.json();

        // Agrupar por mês
        const meses = Array(12).fill().map(() => ({
            freteTotal: 0,
            vendaTotal: 0,
            lucroTotal: 0,
            custoTotal: 0,
            impostoTotal: 0
        }));

        dadosAno.forEach(r => {
            const data = new Date(r.data_emissao);
            const mes = data.getMonth();
            const venda = r.venda || 0;
            const lucro = (venda - (r.custo || 0) - (r.frete || 0) - (r.comissao || 0) - (r.imposto_federal || 0));
            meses[mes].freteTotal += r.frete || 0;
            meses[mes].vendaTotal += venda;
            meses[mes].lucroTotal += lucro;
            meses[mes].custoTotal += r.custo || 0;
            meses[mes].impostoTotal += r.imposto_federal || 0;
        });

        const mesesNomes = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

        // Paginação
        const totalPaginas = Math.ceil(12 / mesesPorPagina);
        const inicio = (relatorioPagina - 1) * mesesPorPagina;
        const fim = inicio + mesesPorPagina;
        const mesesPagina = mesesNomes.slice(inicio, fim);

        let html = '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 1.5rem;">';

        mesesPagina.forEach((nome, idx) => {
            const mesIndex = inicio + idx;
            const m = meses[mesIndex];
            const percentualFrete = m.vendaTotal ? ((m.freteTotal / m.vendaTotal) * 100).toFixed(2) : '0.00';
            const lucroBruto = m.lucroTotal - m.custoTotal;
            const lucroBrutoClass = lucroBruto >= 0 ? 'stat-value-success' : 'stat-value-danger';

            html += `
                <div style="padding: 1rem; background: var(--bg-card); border: 1px solid rgba(107,114,128,0.2); border-radius: 8px;">
                    <h4 style="margin:0 0 0.75rem 0; color: var(--text-primary);">${nome}</h4>
                    <div style="margin-bottom:0.5rem;"><span style="color:#3B82F6;">Frete:</span> ${percentualFrete}%</div>
                    <div style="margin-bottom:0.5rem;">Lucro: ${formatarMoeda(m.lucroTotal)}</div>
                    <div style="margin-bottom:0.5rem;">Custo: ${formatarMoeda(m.custoTotal)}</div>
                    <div style="margin-bottom:0.5rem;">Lucro Bruto: <span class="${lucroBrutoClass}">${formatarMoeda(lucroBruto)}</span></div>
                    <div>Simples: ${formatarMoeda(m.impostoTotal)}</div>
                </div>
            `;
        });

        html += '</div>';

        // Paginação
        html += `
            <div style="display: flex; justify-content: center; gap: 1rem; margin-bottom: 1.5rem;">
                <button onclick="changeRelatorioPagina(-1)" ${relatorioPagina === 1 ? 'disabled' : ''}>‹</button>
                <span>${relatorioPagina}</span>
                <button onclick="changeRelatorioPagina(1)" ${relatorioPagina === totalPaginas ? 'disabled' : ''}>›</button>
            </div>
        `;

        // Totais do ano
        const totalVendaAno = meses.reduce((acc, m) => acc + m.vendaTotal, 0);
        const totalFreteAno = meses.reduce((acc, m) => acc + m.freteTotal, 0);
        const totalLucroAno = meses.reduce((acc, m) => acc + m.lucroTotal, 0);
        const totalCustoAno = meses.reduce((acc, m) => acc + m.custoTotal, 0);
        const totalImpostoAno = meses.reduce((acc, m) => acc + m.impostoTotal, 0);
        const lucroBrutoAno = totalLucroAno - totalCustoAno;
        const lucroBrutoAnoClass = lucroBrutoAno >= 0 ? 'stat-value-success' : 'stat-value-danger';

        html += `
            <div style="display: flex; gap: 1rem; justify-content: center; max-width: 800px; margin: 0 auto;">
                <div style="flex:1; text-align:center; padding:1rem; background:var(--bg-card); border-radius:8px;">
                    <div>Total Frete</div>
                    <div style="font-weight:700;">${formatarMoeda(totalFreteAno)}</div>
                </div>
                <div style="flex:1; text-align:center; padding:1rem; background:var(--bg-card); border-radius:8px;">
                    <div>Total Lucro</div>
                    <div style="font-weight:700;">${formatarMoeda(totalLucroAno)}</div>
                </div>
                <div style="flex:1; text-align:center; padding:1rem; background:var(--bg-card); border-radius:8px;">
                    <div>Total Custo</div>
                    <div style="font-weight:700;">${formatarMoeda(totalCustoAno)}</div>
                </div>
            </div>
            <div style="display: flex; gap: 1rem; justify-content: center; max-width: 800px; margin: 1rem auto 0;">
                <div style="flex:1; text-align:center; padding:1rem; background:var(--bg-card); border-radius:8px;">
                    <div>Lucro Bruto</div>
                    <div style="font-weight:700;" class="${lucroBrutoAnoClass}">${formatarMoeda(lucroBrutoAno)}</div>
                </div>
                <div style="flex:1; text-align:center; padding:1rem; background:var(--bg-card); border-radius:8px;">
                    <div>Simples (Total Imp.)</div>
                    <div style="font-weight:700;">${formatarMoeda(totalImpostoAno)}</div>
                </div>
            </div>
            <div style="margin-top:2rem; display:flex; flex-direction:column; align-items:center;">
                <div style="margin-bottom:0.5rem;">Diferença (R$)</div>
                <input type="number" id="diferencaInput" step="0.01" value="0" style="max-width:200px; text-align:center;">
                <div style="margin-top:1rem; font-size:1.2rem; font-weight:700;" id="lucroRealFinal">${formatarMoeda(lucroBrutoAno)}</div>
            </div>
        `;

        document.getElementById('relatorioBody').innerHTML = html;

        // Adicionar listener para o campo diferença
        document.getElementById('diferencaInput').addEventListener('input', function() {
            const dif = parseFloat(this.value) || 0;
            const final = lucroBrutoAno - dif;
            const span = document.getElementById('lucroRealFinal');
            span.textContent = formatarMoeda(final);
            span.className = final >= 0 ? 'stat-value-success' : 'stat-value-danger';
        });

    } catch (error) {
        console.error('Erro ao carregar dados anuais', error);
        document.getElementById('relatorioBody').innerHTML = '<p style="text-align:center;">Erro ao carregar dados.</p>';
    }
}

function changeRelatorioPagina(direction) {
    relatorioPagina += direction;
    renderRelatorio();
}

// ============================================
// CALENDÁRIO (funções chamadas pelo calendar.js)
// ============================================
let calendarYear = new Date().getFullYear();

function toggleCalendar() {
    const modal = document.getElementById('calendarModal');
    if (modal.classList.contains('show')) {
        modal.classList.remove('show');
    } else {
        calendarYear = currentMonth.getFullYear();
        renderCalendar();
        modal.classList.add('show');
    }
}

function changeCalendarYear(direction) {
    calendarYear += direction;
    renderCalendar();
}

function renderCalendar() {
    const yearElement = document.getElementById('calendarYear');
    const monthsContainer = document.getElementById('calendarMonths');
    if (!yearElement || !monthsContainer) return;

    yearElement.textContent = calendarYear;

    const monthNames = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    monthsContainer.innerHTML = '';

    monthNames.forEach((name, index) => {
        const monthButton = document.createElement('div');
        monthButton.className = 'calendar-month';
        monthButton.textContent = name;

        if (calendarYear === currentMonth.getFullYear() && index === currentMonth.getMonth()) {
            monthButton.classList.add('current');
        }

        monthButton.onclick = () => selectMonth(index);
        monthsContainer.appendChild(monthButton);
    });
}

function selectMonth(monthIndex) {
    currentMonth = new Date(calendarYear, monthIndex, 1);
    updateDisplay();
    toggleCalendar();
    loadLucroReal();
}
