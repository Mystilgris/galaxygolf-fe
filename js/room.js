// room.js — Room page logic: UC1 Create Room, UC3 Join Game, UC4 Choose Course,
// UC2 Start Game (host side). Needs api.js loaded first.
//
// HOW WE GET HERE
//   CreateRoom.html submits  Room.html?username=Ann            -> create
//   JoinRoom.html   submits  Room.html?RoomCode=123456&Username=Bob -> join
// Both forms already use GET, so the values arrive in the URL.

const MIN_PLAYERS = 2; // UC2 precondition 3

const params = new URLSearchParams(window.location.search);
const roomCode = params.get("RoomCode");                  // only set when joining
const username = params.get("username") || params.get("Username");
const isHost = !roomCode;                               // creator = host (UC1 rule)

const codeEl = document.getElementById("room-code");
const playersEl = document.getElementById("player-list");
const statusEl = document.getElementById("room-status");
const startBtn = document.getElementById("start-button");
const leaveBtn = document.getElementById("leave-button");
const roomView = document.getElementById("room-view");// UC1-UC4 view, hidden when the game starts
const courseBtns = document.querySelectorAll(".course-button");

let room = null; // latest room snapshot from the server

if (!username) {
    // Opened Room.html directly with no form data: nothing to connect with.
    window.location.href = "HomePage.html";
}

const socket = isHost
    ? connectCreateRoom(username)
    : connectJoinRoom(roomCode, username);

//  server -> page 

// Every one of these events carries the full room, so one render covers all.
[RECEIVE.USER_JOINED, RECEIVE.USER_LEFT, RECEIVE.COURSE_CHANGED].forEach(evt =>
    socket.on(evt, data => {
        room = data;
        render();
    })
);

// socket.on(RECEIVE.GAME_STARTED, data => {
//     room = data;
//     // TODO (team decision): see the note in the README section / PR.
//     // Navigating to Game.html closes this socket. The backend keeps the
//     // username in the room, so Game.html cannot simply re-join (it gets 409).
//     // Until that is settled we keep everyone on this page.
//     showStatus("Game started! (Game page hookup is the next step.)");
// });
socket.on(RECEIVE.GAME_STARTED, data => {
    room = data;
    // Switch views instead of navigating to another page. Loading a new page
    // would close this socket, and the backend won't let the same username
    // join again (409), so the player would be locked out of their own game.
    showGameView(); // defined in game.js
});
socket.on(RECEIVE.ERROR, text => showStatus(text, true));

// UC8 / UC9: the host left, so the server deleted the room. Everyone else is
// sent back to the main menu, because a room with no host can't start.
socket.on(RECEIVE.ROOM_REMOVED, () => {
    leaving = true; // the room is gone: no "are you sure?" prompt
    if (courseFinished) {
        // Players looking at the final results can stay and read them.
        showGameStatus("The host has left the room.");
        return;
    }
    const msg = "The host left, so the room was closed. Returning to the main menu...";
    if (inGame) showGameStatus(msg, true);
    else showStatus(msg, true);
    setTimeout(() => { window.location.href = "HomePage.html"; }, 2500);
});

socket.on(RECEIVE.CLOSED, ({ everConnected }) => {
    if (leaving) return; // we closed it on purpose
    if (!everConnected) {
        // UC3 alt flows: wrong code, taken username, or the game has already
        // started. The browser can't tell which one happened.
        showStatus("Couldn't join. Check the room code, try a different username, " +
            "or the game may have already started.", true);
        setTimeout(() => {
            window.location.href = isHost ? "CreateRoom.html" : "JoinRoom.html";
        }, 2500);
    } else {
        showStatus("Lost connection to the server.", true);
    }
});

// page -> server 

courseBtns.forEach(btn => {
    btn.disabled = !isHost; // UC4: only the host chooses
    btn.addEventListener("click", () => {
        socket.send(SEND.COURSE_CHANGE, { course: btn.dataset.course });
        // No local highlight here: we wait for "course.changed" so every
        // player's screen updates from the same server message (UC4 step 4.4).
    });
});

startBtn.hidden = !isHost; // UC2: only the host sees Start
startBtn.addEventListener("click", () => {
    if (!room) return;
    const playerCount = Object.keys(room.users || {}).length;

    if (playerCount < MIN_PLAYERS) {          // UC2 alt flow 2.1
        showStatus(`Waiting for players — need at least ${MIN_PLAYERS}.`, true);
        return;
    }
    if (!room.course || !room.course.id) {   // UC2 alt flow 2.2
        showStatus("Select a course before starting.", true);
        return;
    }
    socket.send(SEND.GAME_START);
});

// leaveBtn.addEventListener("click", () => {
//     // Backend refuses "user.leave" from the host (ErrHostCantLeave), so the
//     // host just disconnects.
//     if (!isHost) socket.send(SEND.USER_LEAVE);
//     socket.close();
//     window.location.href = "HomePage.html";
// });
let leaving = false; // true once the player chose to leave

leaveBtn.addEventListener("click", leaveRoom);

// UC8 Leave Room / UC9 Leave Game. game.js uses this too.
// UC8 Leave Room / UC9 Leave Game. game.js uses this too.
function leaveRoom() {
    if (leaving) return;
    leaving = true; // skip the "are you sure?" refresh warning below

    // Everyone sends "user.leave", the host included. The server removes a
    // player and tells the others ("user.leaved"); for the host it deletes
    // the room and tells the others ("room.removed").
    socket.send(SEND.USER_LEAVE);

    // Wait for the server to close our connection (or 1 second) before
    // changing pages. Changing pages straight away can cut the connection
    // before "user.leave" is sent, and then the other players are never told.
    const goHome = () => { window.location.href = "HomePage.html"; };
    socket.ws.addEventListener("close", goHome);
    setTimeout(goHome, 1000);
}

// Refreshing or closing the tab drops the socket, and the player can't get
// back in with the same name. Ask the browser to confirm first.
window.addEventListener("beforeunload", e => {
    if (leaving || !socket.everConnected) return;
    e.preventDefault();
    e.returnValue = ""; // older browsers need this to show the prompt
});

// drawing

function render() {
    codeEl.textContent = room.room_code;

    const names = Object.keys(room.users || {});
    playersEl.innerHTML = "";
    if (names.length === 0) {
        playersEl.innerHTML = "<li>Waiting for players...</li>";
    }
    names.forEach(name => {
        const li = document.createElement("li");
        li.textContent = name === username ? `${name} (you)` : name;
        playersEl.appendChild(li);
    });

    const selected = room.course && room.course.id;
    courseBtns.forEach(btn =>
        btn.classList.toggle("selected", btn.dataset.course === selected)
    );
}

function showStatus(text, isError = false) {
    statusEl.textContent = text;
    statusEl.classList.toggle("error", isError);
}