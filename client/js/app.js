const tg = window.Telegram.WebApp;
tg.expand();

const PUBLIC_API_URL = window.location.origin;

let socket = null;
let currentToken = null;
let activeBingoCard = null;
let isAutomaticMode = true;

// Build the authoritative 75-number left board grid layout panel on load
function buildMasterBoardLayout() {
  const lanes = {
    'B': { start: 1, end: 15, target: document.getElementById('lane-B') },
    'I': { start: 16, end: 30, target: document.getElementById('lane-I') },
    'N': { start: 31, end: 45, target: document.getElementById('lane-N') },
    'G': { start: 46, end: 60, target: document.getElementById('lane-G') },
    'O': { start: 61, end: 75, target: document.getElementById('lane-O') }
  };

  for (const letter in lanes) {
    const lane = lanes[letter];
    if (!lane.target) continue;
    lane.target.innerHTML = '';
    for (let i = lane.start; i <= lane.end; i++) {
      const cell = document.createElement('div');
      cell.className = 'board-cell';
      cell.id = `master-cell-${i}`;
      cell.innerText = i;
      lane.target.appendChild(cell);
    }
  }
}

function clearMasterBoardHighlights() {
  document.querySelectorAll('.board-cell').forEach(c => c.classList.remove('called'));
  const historyBar = document.getElementById('drawn-balls-history');
  if (historyBar) historyBar.innerHTML = '';
}

async function initAuthenticationPipeline() {
  buildMasterBoardLayout();
  const initData = tg.initData;
  
  try {
    const res = await fetch(`${PUBLIC_API_URL}/api/auth/telegram-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData: initData || "test_mode=true&hash=mock" })
    });
    const data = await res.json();
    
    if (data.success) {
      currentToken = data.token;
      
      const userElement = document.getElementById('player-username');
      if (userElement) userElement.innerText = `@${data.user.username || 'Player'}`;
      
      const balElement = document.getElementById('player-balance');
      if (balElement) balElement.innerText = `${data.user.balance.toFixed(2)} ETB`;
      
      const tierElement = document.getElementById('player-tier');
      if (tierElement) tierElement.innerText = `Level ${data.user.level || 1}`;
      
      initializeSocketConnections(data.token);
    } else {
      document.getElementById('game-round-info').innerText = "Security Authorization Failed.";
    }
  } catch (err) {
    console.error("Auth routing failure:", err);
    document.getElementById('game-round-info').innerText = "API Gateway Offline.";
  }
}

function initializeSocketConnections(token) {
  socket = io(PUBLIC_API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    secure: true
  });

  socket.on('sync_state', (data) => {
    updateGameStatusDisplay(data);
  });

  socket.on('game_countdown', (data) => {
    document.getElementById('timer-label').innerText = `NEXT ROUND COUNTDOWN`;
    document.getElementById('active-ball').innerText = data.countdown;
    document.getElementById('game-round-info').innerText = `Registering entries for Round #${data.roundId}`;
    document.getElementById('game-balls-called').innerText = '0';
    document.getElementById('game-id-val').innerText = `R-${data.roundId}`;
    clearMasterBoardHighlights();
  });

  socket.on('game_state_change', (data) => {
    if (data.state === 'drawing') {
      document.getElementById('timer-label').innerText = `DRAWING BALLS`;
      document.getElementById('btn-buy-ticket').style.display = 'none';
    }
  });

  socket.on('number_drawn', (data) => {
    const ball = data.ball;
    let letter = 'B';
    if (ball >= 16 && ball <= 30) letter = 'I';
    else if (ball >= 31 && ball <= 45) letter = 'N';
    else if (ball >= 46 && ball <= 60) letter = 'G';
    else if (ball >= 61 && ball <= 75) letter = 'O';

    document.getElementById('active-ball').innerText = `${letter}-${ball}`;
    document.getElementById('timer-label').innerText = `LIVE BROADCAST`;
    document.getElementById('game-balls-called').innerText = data.history.length;

    // Highlight left tracking board cell
    const masterCell = document.getElementById(`master-cell-${ball}`);
    if (masterCell) masterCell.classList.add('called');

    // Slide letter-number ball into history ticker bar
    const historyBar = document.getElementById('drawn-balls-history');
    if (historyBar) {
      const miniBall = document.createElement('div');
      miniBall.className = 'history-ball-mini';
      miniBall.innerText = `${letter}-${ball}`;
      
      // Match color theme based on category ranges
      if (letter === 'B') miniBall.style.background = '#0288d1';
      else if (letter === 'I') miniBall.style.background = '#512da8';
      else if (letter === 'N') miniBall.style.background = '#c2185b';
      else if (letter === 'G') miniBall.style.background = '#388e3c';
      else miniBall.style.background = '#f57c00';

      historyBar.insertBefore(miniBall, historyBar.firstChild);
    }

    highlightMatchingMatrixCells(ball);
  });

  socket.on('game_over', (data) => {
    document.getElementById('timer-label').innerText = `ROUND ENDED`;
    document.getElementById('active-ball').innerText = "🏁";
    if (data.winnerId) {
      document.getElementById('game-round-info').innerText = `Winner: ${data.winnerUsername} 🎉 Pool: ${data.prize} ETB`;
    } else {
      document.getElementById('game-round-info').innerText = "Round finished with no winners.";
    }
    setTimeout(() => {
      document.getElementById('cartela-subview-card').style.display = 'none';
      document.getElementById('btn-buy-ticket').style.display = 'block';
      activeBingoCard = null;
      syncBalanceTelemetry();
      clearMasterBoardHighlights();
    }, 6000);
  });
}

function updateGameStatusDisplay(data) {
  if (data.state === 'waiting') {
    document.getElementById('timer-label').innerText = `AWAITING TICKETS`;
    document.getElementById('active-ball').innerText = data.countdown;
  } else if (data.state === 'drawing') {
    document.getElementById('timer-label').innerText = `LIVE BALL ENGINE`;
    document.getElementById('active-ball').innerText = data.drawnNumbers[data.drawnNumbers.length - 1] || "--";
  }
}

document.getElementById('btn-buy-ticket').addEventListener('click', () => {
  if (!socket) return;
  socket.emit('buy_ticket', (res) => {
    if (res.success) {
      activeBingoCard = res.card;
      renderBingoMatrixGrid(res.card);
      document.getElementById('btn-buy-ticket').style.display = 'none';
      document.getElementById('cartela-subview-card').style.display = 'block';
      document.getElementById('cartela-serial-id').innerText = `CARTELA #${Math.floor(Math.random() * 900) + 100}`;
      syncBalanceTelemetry();
    } else {
      alert(res.error || "Failed to buy entry ticket.");
    }
  });
});

function renderBingoMatrixGrid(matrix) {
  const grid = document.getElementById('bingo-card-grid');
  grid.innerHTML = '';
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const val = matrix[r][c];
      const cell = document.createElement('div');
      cell.className = "bingo-cell";
      if (val === 0) {
        cell.className += " free-space marked";
        cell.innerText = "★";
      } else {
        cell.innerText = val;
        cell.setAttribute('data-num', val);
      }
      grid.appendChild(cell);
    }
  }
}

function highlightMatchingMatrixCells(number) {
  const cells = document.querySelectorAll(`.bingo-cell[data-num="${number}"]`);
  cells.forEach(c => c.classList.add('marked'));
}

document.getElementById('btn-auto-toggle').addEventListener('click', () => {
  isAutomaticMode = !isAutomaticMode;
  document.getElementById('btn-auto-toggle').style.background = isAutomaticMode ? '#06d6a0' : '#4b5563';
  document.getElementById('btn-auto-toggle').style.color = isAutomaticMode ? '#000' : '#fff';
});

function switchView(target) {
  document.querySelectorAll('.view-panel').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  
  document.getElementById(`view-${target}`).classList.add('active');
  document.getElementById(`nav-${target}`).classList.add('active');
  
  if (target === 'history') fetchStatementHistory();
}

async function syncBalanceTelemetry() {
  if (!currentToken) return;
  const res = await fetch(`${PUBLIC_API_URL}/api/wallet/balance`, {
    headers: { 'Authorization': `Bearer ${currentToken}` }
  });
  const data = await res.json();
  if (data.balance !== undefined) {
    document.getElementById('player-balance').innerText = `${data.balance.toFixed(2)} ETB`;
  }
}

window.switchView = switchView;
initAuthenticationPipeline();
