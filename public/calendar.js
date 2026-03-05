// ============================================
// CALENDAR MODAL FUNCTIONALITY
// Lucro Real - Month Navigation
// ============================================

// calendarYear está declarado no script.js

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
        'JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 
        'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 
        'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'
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

document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('calendarModal');
    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('show');
            }
        });
    }
});
