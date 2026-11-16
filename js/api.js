// api.js — the one place the frontend talks to the Go backend (galaxygolf-be).
//
// WHY a WebSocket and not fetch():
//   The backend has no normal REST endpoints. Both routes in cmd/api/main.go
//   (/api/room/create and /api/room/join) immediately "upgrade" the HTTP
//   request into a WebSocket. Every later action (pick course, start game,
//   move ball, leave) is a JSON message sent over that same socket.
//
// Message format (backend: internal/dto/ws.go -> WSMessage):
//   { "event": "<name>", "data": { ... } }
//
// Loaded as a plain <script> (not an ES module) so the pages still work
// when opened straight from disk or through VS Code Live Server.

// Change this if the backend runs somewhere other than your own machine.
const API_BASE = "ws://localhost:8080/api";

// Events the BROWSER sends (backend: internal/ws/router.go)
const SEND = {
    COURSE_CHANGE: "course.change", // data: { course: "course1" }   host only
    GAME_START:    "game.start",    // data: {}                       host only
    BALL_UPDATE:   "ball.update",   // data: { position_x, position_y, velocity_x, velocity_y, in_hole }
    USER_LEAVE:    "user.leave",    // data: {}                       host is refused
};

// Events the SERVER sends back (backend: internal/ws/events.go).
// Every one of them carries the whole room as `data` (dto.RoomResponse):
//   { room_code: 123456, course: { id: "course1", ... },
//     users: { "<username>": { next_position_x, next_position_y,
//              velocity_x, velocity_y, in_hole,
//              current_map_strokes, total_strokes } } }
const RECEIVE = {
    USER_JOINED:    "user.joined",
    USER_LEFT:      "user.leaved",   // spelled this way in the backend
    COURSE_CHANGED: "course.changed",
    GAME_STARTED:   "game.started",
    BALL_MOVED:     "ball.moved",
    NEXT_MAP:       "map.next",
    ERROR:          "error",         // raised by this file for any error text
    CLOSED:         "closed",        // raised by this file when the socket closes
};

// A small wrapper around the browser WebSocket so pages can write
//   socket.on("user.joined", room => ...)   and   socket.send("game.start")
// instead of parsing raw messages themselves.
class GameSocket {
    constructor(url) {
        this.handlers = {};      // event name -> list of callbacks
        this.everConnected = false;
        this.ws = new WebSocket(url);

        this.ws.onopen = () => {
            this.everConnected = true;
        };

        this.ws.onmessage = (msg) => {
            let parsed;
            try {
                parsed = JSON.parse(msg.data);
            } catch {
                // The backend also sends some errors as plain text
                // (see internal/ws/client.go readPump), e.g. "you're not host".
                this.emit(RECEIVE.ERROR, msg.data);
                return;
            }
            // The JSON "error" event carries an empty object, so the useful
            // text arrives in the plain-text message right after it. Skip it.
            if (parsed.event === "error") return;
            this.emit(parsed.event, parsed.data);
        };

        // A browser cannot read the HTTP status of a failed upgrade, so a
        // wrong room code (404) and a taken username (409) both look the
        // same here: the socket fails without ever opening.
        // Browsers fire "error" then "close"; some runtimes fire only "error",
        // so both report, and `closedReported` stops a double message.
        this.closedReported = false;
        const reportClosed = (code) => {
            if (this.closedReported) return;
            this.closedReported = true;
            this.emit(RECEIVE.CLOSED, { everConnected: this.everConnected, code });
        };
        this.ws.onerror = () => reportClosed(1006);
        this.ws.onclose = (e) => reportClosed(e.code);
    }

    on(event, callback) {
        (this.handlers[event] ||= []).push(callback);
        return this; // allows socket.on(...).on(...)
    }

    emit(event, data) {
        (this.handlers[event] || []).forEach(cb => cb(data));
    }

    send(event, data = {}) {
        if (this.ws.readyState !== WebSocket.OPEN) {
            console.warn("Socket not open; dropped", event);
            return;
        }
        this.ws.send(JSON.stringify({ event, data }));
    }

    close() {
        this.ws.close();
    }
}

// UC1 Create Room: the person who calls this becomes the host.
function connectCreateRoom(username) {
    const q = new URLSearchParams({ username });
    return new GameSocket(`${API_BASE}/room/create?${q}`);
}

// UC3 Join Game: roomCode is the 6-digit number the host sees.
function connectJoinRoom(roomCode, username) {
    const q = new URLSearchParams({ room_id: roomCode, username });
    return new GameSocket(`${API_BASE}/room/join?${q}`);
}