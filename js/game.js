// game.js — Game view inside Room.html (groundwork for UC5-UC9).
// Loaded after api.js and room.js, and uses what they set up:
//   socket   – the ONE WebSocket opened in room.js
//   room     – the latest room snapshot (both files keep it up to date)
//   username – this player's name
//   roomView – the room section, hidden when the game starts
//   leaveRoom() – shared leave logic (UC8 / UC9)
//
// WHY the game is on the same page as the room:
//   Going to another page would close the socket, and the backend keeps the
//   username in the room, so that player could never get back in (409).
//   Staying on one page keeps the connection, and the room's data (course,
//   players, scores) with it, for the whole game.

const gameView     = document.getElementById("game-view");
const turnLabel    = document.getElementById("turn-label");
const holeLabel    = document.getElementById("hole-label");
const scoreHead    = document.getElementById("score-head");
const scoreBody    = document.getElementById("score-body");
const gameStatusEl = document.getElementById("game-status");
const gameLeaveBtn = document.getElementById("game-leave-button");

let inGame = false;
let currentHole = 1;
let turnPlayer = null;     // whose turn it is (worked out here, see nextTurn)
const holeScores = {};     // username -> strokes for each FINISHED hole

// Called by room.js when the server sends "game.started" (UC2 step 2.3).
function showGameView() {
    inGame = true;
    roomView.hidden = true;
    gameView.hidden = false;

    currentHole = 1;
    Object.keys(room.users).forEach(name => (holeScores[name] = []));
    turnPlayer = nextTurn(room, null);   // UC2 postcondition 4: first turn
    renderGame();
}

// server -> page 

// Someone hit their ball (UC5). The server added 1 stroke for them.
socket.on(RECEIVE.BALL_MOVED, data => {
    room = data;
    turnPlayer = nextTurn(room, turnPlayer); // UC5 postcondition 4
    renderGame();
    // TODO UC5: animate the ball using each user's position/velocity.
});

// Every ball is in the hole, so the server moved everyone on (UC6).
socket.on(RECEIVE.NEXT_MAP, data => {
    // The server has already reset current_map_strokes to 0 for the new
    // hole, so the finished hole's score = total strokes minus the strokes
    // from the holes before it.
    Object.entries(data.users).forEach(([name, user]) => {
        const scores = (holeScores[name] ||= []);
        const earlier = scores.reduce((sum, s) => sum + s, 0);
        scores.push(user.total_strokes - earlier);
    });
    room = data;
    currentHole += 1;
    turnPlayer = nextTurn(room, null);
    renderGame();
    // TODO UC7: when the last hole is done, show final results. The backend
    // doesn't send the number of holes yet (course.maps is null).
});

// A player left mid-game (UC9). Skip them if it was their turn.
socket.on(RECEIVE.USER_LEFT, data => {
    if (!inGame) return; // room.js already handles this before the game
    room = data;
    if (!(turnPlayer in room.users)) turnPlayer = nextTurn(room, null);
    renderGame();
});

// While in the game, errors go to the game's status line (the room's
// status line is hidden).
socket.on(RECEIVE.ERROR, text => inGame && showGameStatus(text, true));
socket.on(RECEIVE.CLOSED, () =>
    inGame && showGameStatus("Lost connection to the server.", true)
);

// page -> server 

gameLeaveBtn.addEventListener("click", leaveRoom); // UC9 Leave Game

// UC5 Hit Golf Ball: the shot code calls this once it has worked out where
// the ball goes. Also handy for testing from the browser console, e.g.
//   sendBallUpdate({ position_x: 120, position_y: 80, velocity_x: 3, velocity_y: -1, in_hole: false })
function sendBallUpdate(shot) {
    if (turnPlayer !== username) {
        showGameStatus(`It's ${turnPlayer}'s turn.`, true);
        return;
    }
    socket.send(SEND.BALL_UPDATE, {
        position_x: shot.position_x,
        position_y: shot.position_y,
        velocity_x: shot.velocity_x,
        velocity_y: shot.velocity_y,
        in_hole:    shot.in_hole,
    });
}

// turn order 

// The backend doesn't track turns yet, so every browser works the turn out
// the same way from the same server message: players in name order, skipping
// anyone whose ball is already in the hole (UC5 special requirement).
function nextTurn(roomData, after) {
    const names = Object.keys(roomData.users).sort();
    const stillPlaying = names.filter(n => !roomData.users[n].in_hole);
    if (stillPlaying.length === 0) return null;

    const start = after === null ? -1 : names.indexOf(after);
    for (let i = 1; i <= names.length; i++) {
        const candidate = names[(start + i) % names.length];
        if (stillPlaying.includes(candidate)) return candidate;
    }
    return stillPlaying[0];
}

// drawing -

function renderGame() {
    turnLabel.textContent =
        turnPlayer === username ? `${turnPlayer} (your turn)` : (turnPlayer ?? "-");
    holeLabel.textContent = currentHole;

    // Header: Player | Hole 1 ... current hole | Total
    scoreHead.innerHTML = "";
    const headers = ["Player"];
    for (let h = 1; h <= currentHole; h++) headers.push(`Hole ${h}`);
    headers.push("Total");
    headers.forEach(text => {
        const th = document.createElement("th");
        th.textContent = text;
        scoreHead.appendChild(th);
    });

    // One row per player
    scoreBody.innerHTML = "";
    Object.keys(room.users).sort().forEach(name => {
        const user = room.users[name];
        const finished = holeScores[name] || [];
        const cells = [
            name === username ? `${name} (you)` : name,
            ...finished,
            user.current_map_strokes, // the hole being played now
        ];

        const tr = document.createElement("tr");
        cells.forEach(value => {
            const td = document.createElement("td");
            td.textContent = value;
            tr.appendChild(td);
        });
        const total = document.createElement("td");
        total.className = "total-score";
        total.textContent = user.total_strokes;
        tr.appendChild(total);

        scoreBody.appendChild(tr);
    });
}

function showGameStatus(text, isError = false) {
    gameStatusEl.textContent = text;
    gameStatusEl.classList.toggle("error", isError);
}