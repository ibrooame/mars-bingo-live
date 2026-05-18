const tg = window.Telegram.WebApp;
tg.expand();

const PUBLIC_API_URL = window.location.origin;

let socket = null;
let currentToken = null;
let activeBingoCard = null;

async function initAuthenticationPipeline() {
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
    document.getElementById('game-round-info').innerText = "API Connection Gateway Offline.";
  }
}

function initializeSocketConnections(token) {
  // FORCE SECURE SECURE HTTPS / WSS TRANSPORTS FOR RENDER LOAD BALANCERS
  socket = io(PUBLIC_API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    secure: true,
    rejectUnauthorized: false
  });

  socket.on('connect', () => {
    console.log('✅ Connected securely to server matrix socket pool!');
  });

  socket.on('sync_state', (data) => {
    updateGameStatusDisplay(data);
  });

  socket.on('game_countdown', (data) => {
    const timerLabel = document.getElementById('timer-label');
    if (timerLabel) timerLabel.innerText = `NEXT ROUND COUNTDOWN`;
    
    const activeBall = document.getElementById('active-ball');
    if (activeBall) activeBall.innerText = data.countdown;
    
    const roundInfo = document.getElementById('game-round-info');
    if (roundInfo) roundInfo.innerText = `Registering Entries for Round #${data.roundId}`;
  });

  socket.on('game_state_change', (data) => {
    if (data.state === 'drawing') {
      document.getElementById('timer-label').innerText = `DRAWING NUMBERS`;
      document.getElementById('btn-buy-ticket').style.display = 'none';
    }
  });

  socket.on('number_drawn', (data) => {
    document.getElementById('active-ball').innerText = data.ball;
    document.getElementById('game-round-info').innerText = `Drawn Numbers: ${data.history.length}`;
    highlightMatchingMatrixCells(data.ball);
  });

  socket.on('game_over', (data) => {
    document.getElementById('timer-label').innerText = `ROUND COMPLETED`;
    document.getElementById('active-ball').innerText = "🏁";
    if (data.winnerId) {
      document.getElementById('game-round-info').innerText = `Winner: ${data.winnerUsername} 🎉 Pool: ${data.prize} ETB`;
    } else {
      document.getElementById('game-round-info').innerText = "Round finished with no winners.";
    }
    setTimeout(() => {
      document.getElementById('bingo-card-grid').innerHTML = '';
      document.getElementById('btn-buy-ticket').style.display = 'block';
      activeBingoCard = null;
      syncBalanceTelemetry();
    }, 5000);
  });

  socket.on('msg_broadcast', (data) => {
    const stream = document.getElementById('chat-stream');
    const row = document.createElement('div');
    row.className = "chat-row";
    row.innerHTML = `<span class="chat-user">${data.username}:</span> ${data.message}`;
    stream.appendChild(row);
    stream.scrollTop = stream.scrollHeight;
  });
}

function updateGameStatusDisplay(data) {
  if (data.state === 'waiting') {
    document.getElementById('timer-label').innerText = `AWAITING PLAYERS`;
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
      syncBalanceTelemetry();
    } else {
      alert(res.error || "Failed to purchase entry ticket.");
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
        cell.innerText = "FREE";
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

document.getElementById('btn-send-chat').addEventListener('click', () => {
  const input = document.getElementById('chat-msg-input');
  if (!input.value.trim() || !socket) return;
  socket.emit('send_msg', { message: input.value.trim() });
  input.value = '';
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

document.getElementById('btn-submit-deposit').addEventListener('click', async () => {
  const amount = document.getElementById('deposit-amount').value;
  const txid = document.getElementById('deposit-txid').value;
  if (!amount || !txid) return alert("Please fill out all fields.");

  const res = await fetch(`${PUBLIC_API_URL}/api/wallet/deposit`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    },
    body: JSON.stringify({ amount, transaction_id: txid })
  });
  const data = await res.json();
  alert(data.message || data.error);
});

document.getElementById('btn-submit-withdrawal').addEventListener('click', async () => {
  const amount = document.getElementById('withdraw-amount').value;
  if (!amount) return alert("Specify withdrawal amount.");

  const res = await fetch(`${PUBLIC_API_URL}/api/wallet/withdraw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${currentToken}`
    },
    body: JSON.stringify({ amount })
  });
  const data = await res.json();
  alert(data.message || data.error);
  syncBalanceTelemetry();
});

async function fetchStatementHistory() {
  const target = document.getElementById('history-log-list');
  target.innerHTML = '<p style="padding:15px; color:var(--text-gray);">Querying ledger profiles...</p>';

  const res = await fetch(`${PUBLIC_API_URL}/api/wallet/history`, {
    headers: { 'Authorization': `Bearer ${currentToken}` }
  });
  const list = await res.json();
  target.innerHTML = '';

  list.forEach(item => {
    const row = document.createElement('div');
    row.style.background = "#161b22";
    row.style.padding = "10px";
    row.style.borderRadius = "6px";
    row.style.marginBottom = "8px";
    row.innerHTML = `
      <div style="display:flex; justify-content:space-between;">
        <strong>${item.type.toUpperCase()}</strong>
        <span style="color:${item.status === 'approved' ? '#238636' : '#ff4757'}">${item.status}</span>
      </div>
      <small style="color:var(--text-gray); display:block; margin-top:4px;">Sum: ${item.amount} ETB</small>
    `;
    target.appendChild(row);
  });
}

window.switchView = switchView;

initAuthenticationPipeline();
