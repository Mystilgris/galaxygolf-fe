// game.js — Game view inside Room.html (groundwork for UC5-UC9).
// Loaded after api.js and room.js, and uses what they set up:
//   socket   – the ONE WebSocket opened in room.js
//   room     – the latest room snapshot (both files keep it up to date)
//   username – this player's name
//   roomView – the room section, hidden when the game starts
//   leaveRoom() – shared leave logic: UC8 leaves the room; UC9 leaves the game
//
// WHY the game is on the same page as the room:
//   Going to another page would close the socket, and the backend keeps the
//   username in the room, so that player could never get back in (409).
//   Staying on one page keeps the connection, and the room's data (course,
//   players, scores) with it, for the whole game.

const gameView = document.getElementById("game-view");
const turnLabel = document.getElementById("turn-label");
const holeLabel = document.getElementById("hole-label");
const scoreHead = document.getElementById("score-head");
const scoreBody = document.getElementById("score-body");
const gameStatusEl = document.getElementById("game-status");
const gameLeaveBtn = document.getElementById("game-leave-button");
const board = document.getElementById("course-board");
const ctx = board.getContext("2d");
const shotForm = document.getElementById("shot-form");
const hitButton = document.getElementById("hit-button");
const results = document.getElementById("game-results");
const winnerLabel = document.getElementById("winner-label");

// The backend doesn't provide the course hole count yet, so the client uses
// the current three-hole course definition until that data is available.
const TOTAL_HOLES = 3;
// Course coordinates use the canvas's 600-by-320 internal drawing size.
const CUP = { x: 560, y: 160, radius: 13 };
const DEFAULT_START = { x: 60, y: 160 };

let inGame = false;
let currentHole = 1;
let turnPlayer = null;     // whose turn it is (worked out here, see nextTurn)
let animationFrame;
let courseFinished = false;
let pendingFinish = false; // finish results only after an in-progress final shot animation
const holeScores = {};     // username -> strokes for each FINISHED hole

// Called by room.js when the server sends "game.started" (UC2 step 2.3).
function showGameView() {
    inGame = true;
    // Reset any previous game state and cancel a frame that could otherwise
    // continue drawing after this new game becomes visible.
    courseFinished = false;
    pendingFinish = false;
    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);
    animationFrame = undefined;
    roomView.hidden = true;
    gameView.hidden = false;
    board.hidden = false;
    shotForm.hidden = false;
    results.hidden = true;
    gameLeaveBtn.textContent = "Leave";
    winnerLabel.textContent = "";

    currentHole = 1;
    Object.keys(room.users).forEach(name => (holeScores[name] = []));
    turnPlayer = nextTurn(room, null);   // UC2 postcondition 4: first turn
    renderGame();
    finishDrawing();
}

// server -> page 

// UC5 — Hit Golf Ball: use the updated room and server shot path to refresh
// scores, calculate the next turn, and animate the moving player's ball.
socket.on(RECEIVE.BALL_MOVED, updateGame);

function updateGame(data) {
    if (courseFinished) return;
    // BALL_MOVED carries the updated room snapshot plus the shot path and
    // moving player's name, so update scores/turn before animating that path.
    room = data;
    turnPlayer = nextTurn(room, turnPlayer); // UC5 postcondition 4
    renderGame();

    // The last shot may put every player in the hole. Defer the results until
    // its path has finished animating; finishDrawing completes that transition.
    if (currentHole === TOTAL_HOLES &&
        Object.values(room.users).every(user => user.in_hole)) {
        pendingFinish = true;
    }

    if (data.path !== undefined) {
        animateShot({ player: data.player, path: data.path });
    } else {
        finishDrawing();
    }
}

// UC6 — Move to Next Hole: after every ball is in, record this hole's scores
// and either advance the hole and choose a new turn or finish the course.
socket.on(RECEIVE.NEXT_MAP, data => {
    if (courseFinished) return;

    // NEXT_MAP arrives after the server resets current_map_strokes. Subtract
    // the already-recorded hole scores from total_strokes to recover the
    // score for the hole that just ended.
    Object.entries(data.users).forEach(([name, user]) => {
        const scores = (holeScores[name] ||= []);
        const earlier = scores.reduce((sum, s) => sum + s, 0);
        scores.push(user.total_strokes - earlier);
    });
    room = data;

    if (currentHole === TOTAL_HOLES) {
        finishCourse();
        return;
    }

    currentHole += 1;
    turnPlayer = nextTurn(room, null);
    renderGame();
    finishDrawing();
});

// UC7 — Show Final Results: use the final room snapshot and wait for an
// in-progress final-shot animation before showing the scorecard and winners.
socket.on(RECEIVE.GAME_ENDED, data => {
    room = data;
    pendingFinish = true;
    // If the final shot is still moving, its animation will call
    // finishDrawing; otherwise results can be shown immediately.
    if (animationFrame === undefined) {
        finishCourse();
    } else {
        renderGame();
    }
});

// UC9 — Leave Game: apply the updated room and select a new turn if the
// departing player had the turn.
socket.on(RECEIVE.USER_LEFT, data => {
    if (!inGame) return; // room.js already handles this before the game
    room = data;
    if (!(turnPlayer in room.users)) turnPlayer = nextTurn(room, null);
    renderGame();
    finishDrawing();
});

// While in the game, errors go to the game's status line (the room's
// status line is hidden).
socket.on(RECEIVE.ERROR, text => inGame && showGameStatus(text, true));
socket.on(RECEIVE.CLOSED, () =>
    inGame && !courseFinished && !leaving &&
    showGameStatus("Lost connection to the server.", true)
);

// page -> server 

// UC9 — Leave Game: use leaveRoom(), the same shared cleanup used by UC8's
// room button, then return to the main menu.
gameLeaveBtn.addEventListener("click", leaveRoom);

// UC5 — Hit Golf Ball: validate the player's angle and power, calculate a
// shot update, and send it to the server.
shotForm.addEventListener("submit", e => {
    e.preventDefault();
    if (hitButton.disabled) return;

    // The form uses degrees for readability; the physics calculation uses
    // radians and a numeric power value.
    const angle = shotForm.elements.angle.valueAsNumber * Math.PI / 180;
    const power = shotForm.elements.power.valueAsNumber;
    if (!Number.isFinite(angle) || !Number.isFinite(power)) {
        showGameStatus("Enter a valid angle and power.", true);
        return;
    }
    showGameStatus("");
    sendBallUpdate(computeShot(room.users[username], angle, power));
});

function computeShot(user, angle, power) {
    // Continue from the server's last position, or use the tee position for a
    // player who has not moved yet. The server remains authoritative on result.
    let x = user.next_position_x ?? DEFAULT_START.x;
    let y = user.next_position_y ?? DEFAULT_START.y;
    let vx = Math.cos(angle) * power * 0.2;
    let vy = Math.sin(angle) * power * 0.2;
    let inHole = false;

    // Approximate the shot locally so the submitted update contains its final
    // position and velocity. Friction slows it each step; the iteration and
    // speed limits keep the simulation bounded.
    for (let i = 0; i < 300 && Math.hypot(vx, vy) > 0.05; i++) {
        x += vx;
        y += vy;
        vx *= 0.97;
        vy *= 0.97;
        // The course edges act as walls; clamp the position after each bounce
        // so the ball stays inside the canvas.
        if (x < 7 || x > board.width - 7) {
            vx = -vx;
            x = Math.min(Math.max(x, 7), board.width - 7);
        }
        if (y < 7 || y > board.height - 7) {
            vy = -vy;
            y = Math.min(Math.max(y, 7), board.height - 7);
        }
        // A ball only drops once it reaches the cup at a slow enough speed.
        if (Math.hypot(x - CUP.x, y - CUP.y) < CUP.radius &&
            Math.hypot(vx, vy) < 4) {
            x = CUP.x;
            y = CUP.y;
            vx = 0;
            vy = 0;
            inHole = true;
            break;
        }
    }
    return {
        position_x: x,
        position_y: y,
        velocity_x: vx,
        velocity_y: vy,
        in_hole: inHole,
    };
}

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
        in_hole: shot.in_hole,
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
    turnLabel.textContent = courseFinished
        ? "Course complete"
        : turnPlayer === username ? `${turnPlayer} (your turn)` : (turnPlayer ?? "-");
    holeLabel.textContent = Math.min(currentHole, TOTAL_HOLES);

    scoreHead.innerHTML = "";
    const headers = ["Player"];
    const shownHoles = courseFinished ? TOTAL_HOLES : currentHole;
    for (let h = 1; h <= shownHoles; h++) headers.push(`Hole ${h}`);
    headers.push("Total");
    headers.forEach(text => {
        const th = document.createElement("th");
        th.textContent = text;
        scoreHead.appendChild(th);
    });

    // Finished holes come from holeScores; during play, append the current
    // hole's live stroke count. After completion, only finalized holes remain.
    scoreBody.innerHTML = "";
    Object.keys(room.users).sort().forEach(name => {
        const user = room.users[name];
        const cells = [
            name === username ? `${name} (you)` : name,
            ...(holeScores[name] || []),
        ];
        if (!courseFinished) cells.push(user.current_map_strokes);

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

    updateButtons();
}

function drawCourse(movingPlayer, point) {
    // Redraw the full course and every stationary ball on each animation
    // frame, then draw the moving ball at its interpolated point.
    ctx.fillStyle = "#245c37";
    ctx.fillRect(0, 0, board.width, board.height);
    drawCircle(CUP.x, CUP.y, CUP.radius, "#102418");

    Object.entries(room.users).forEach(([name, user]) => {
        if (name === movingPlayer || user.in_hole) return;
        drawCircle(
            user.next_position_x ?? DEFAULT_START.x,
            user.next_position_y ?? DEFAULT_START.y,
            7,
            name === username ? "#ffffff" : "#ffd166"
        );
    });
    if (point) drawCircle(point.x, point.y, 7, "#ffffff");
}

function drawCircle(x, y, radius, color) {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
}

function finishDrawing() {
    // Restore the settled course after a shot; a pending final result is
    // displayed only after the moving ball has reached the end of its path.
    drawCourse();
    if (pendingFinish) finishCourse();
}

function updateButtons() {
    // Only the active player can shoot, and no new shot can start during the
    // animation or after the course has ended.
    hitButton.disabled =
        courseFinished || animationFrame !== undefined || turnPlayer !== username;
}

function finishCourse() {
    if (courseFinished) return;
    courseFinished = true;
    pendingFinish = false;
    if (animationFrame !== undefined) {
        cancelAnimationFrame(animationFrame);
        animationFrame = undefined;
    }

    // GAME_ENDED can arrive without a final NEXT_MAP event. In that case,
    // preserve the last hole's strokes from the final room snapshot.
    Object.keys(room.users).forEach(name => {
        const scores = (holeScores[name] ||= []);
        if (scores.length < TOTAL_HOLES) {
            scores.push(room.users[name].current_map_strokes);
        }
    });

    const totals = Object.entries(room.users).map(([name, user]) =>
        [name, user.total_strokes]
    );
    const best = Math.min(...totals.map(([, total]) => total));
    // Prefer the server's winners list; calculate from total_strokes when a
    // locally detected course end does not include that list.
    const winners = Array.isArray(room.winners) && room.winners.length
        ? room.winners
        : totals.filter(([, total]) => total === best).map(([name]) => name);
    const formattedWinners = new Intl.ListFormat("en").format(winners);
    winnerLabel.textContent = winners.length === 1
        ? `Winner: ${formattedWinners}`
        : `Tie: ${formattedWinners}`;

    board.hidden = true;
    shotForm.hidden = true;
    results.hidden = false;
    gameLeaveBtn.textContent = "Main Menu";
    showGameStatus("");
    renderGame();
}

// Animate the ball along the path calculated by the server.
function animateShot({ player, path }) {
    if (!Array.isArray(path) || path.length === 0) {
        showGameStatus("Received an invalid shot path.", true);
        finishDrawing();
        return;
    }

    if (animationFrame !== undefined) cancelAnimationFrame(animationFrame);

    // Scale animation time with path length while keeping a short minimum and
    // a cap so unusually long paths don't make a turn feel unresponsive.
    const start = performance.now();
    const duration = Math.min(1400, Math.max(180, path.length * 23));

    function step(time) {
        const progress = Math.max(0, (time - start) / duration);

        // When the ball stops, finish drawing and update the buttons.
        if (progress >= 1) {
            animationFrame = undefined;
            finishDrawing();
            updateButtons();
            return;
        }

        // Find the two closest points and draw the ball between them.
        // Map elapsed-time progress onto adjacent path points, then linearly
        // interpolate between them to keep the ball motion smooth.
        const index = progress * (path.length - 1);
        const first = path[Math.floor(index)];
        const next = path[Math.ceil(index)];
        const fraction = index % 1;

        drawCourse(player, {
            x: first.x + (next.x - first.x) * fraction,
            y: first.y + (next.y - first.y) * fraction,
        });

        animationFrame = requestAnimationFrame(step);
    }

    animationFrame = requestAnimationFrame(step);
    updateButtons();
}

function showGameStatus(text, isError = false) {
    gameStatusEl.textContent = text;
    gameStatusEl.classList.toggle("error", isError);
}