// ============================================================================
// websocketHandler.js - Updated with Call Integration
// ============================================================================

const WebSocket = require("ws");
const { setupCallHandler } = require("./callHandler");

// Store connections, offline messages, sessions, and registered users
const activeUsers = new Map();
const offlineMessages = new Map();
const userSessions = new Map();
const pendingReadReceipts = new Map();
const registeredUsers = new Map();

// Extract client IP safely
function getClientIp(req) {
    let ip = req.headers["x-forwarded-for"];
    if (ip) ip = ip.split(",")[0].trim();
    else ip = req.socket.remoteAddress || "";

    if (ip.startsWith("::ffff:")) ip = ip.substring(7);
    return ip.split("%")[0];
}

// Generate message IDs
function generateMessageId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Broadcast system messages
function broadcastSystem(text) {
    const payload = {
        type: "system",
        text,
        timestamp: Date.now()
    };

    for (const ws of activeUsers.values()) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }
}

// Broadcast user list to all connected clients
function broadcastUserList() {
    const userList = Array.from(registeredUsers.entries()).map(([id, data]) => ({
        id,
        username: data.username,
        online: activeUsers.has(id)
    }));
    
    const payload = {
        type: "user_list",
        users: userList,
        timestamp: Date.now()
    };

    for (const ws of activeUsers.values()) {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(payload));
        }
    }
}

function setupWebSocketServer(wss) {
    console.log("🚀 WebSocket server running...");

    // Initialize with some default users if empty
    if (registeredUsers.size === 0) {
        registeredUsers.set("1", { username: "User 1", createdAt: new Date() });
        registeredUsers.set("2", { username: "User 2", createdAt: new Date() });
        registeredUsers.set("3", { username: "User 3", createdAt: new Date() });
        registeredUsers.set("4", { username: "User 4", createdAt: new Date() });
    }

    // Initialize call handler
    const callHandler = setupCallHandler(wss, activeUsers, registeredUsers);

    wss.on("connection", (ws, req) => {
        const ip = getClientIp(req);
        ws.userId = null;
        ws.username = null;
        ws.ip = ip;
        ws.isAlive = true;

        console.log(`🔗 New WebSocket connection from ${ip}`);

        ws.on("pong", () => (ws.isAlive = true));

        // Handle all incoming messages
        ws.on("message", (raw) => {
            let data;
            try {
                data = JSON.parse(raw);
                console.log(`📨 Received message:`, data);
            } catch (err) {
                console.error("❌ Invalid JSON:", err.message);
                return;
            }

            // -------------------------------------------------------
            // CALL MESSAGES - Handle first
            // -------------------------------------------------------
// Call messages - Handle first
const callTypes = [
    "call_initiate", "call_answer", "call_reject", "call_end",
    "call_offer", "call_answer_sdp", "call_ice_candidate",  // ← FIXED
    "call_force_cleanup", "call_answer_confirmed"  // Add if you're using this
];

if (callTypes.includes(data.type)) {
    console.log(`📞 Routing ${data.type} to call handler`);
    
    if (data.type === 'call_answer_sdp') {
        console.log('🎯 call_answer_sdp detected! This should forward to caller.');
    }
    
    callHandler.handleCallMessage(ws, data);
    return;
}

            // -------------------------------------------------------
            // 1️⃣ User registration (first message)
            // -------------------------------------------------------
            if (data.userId !== undefined) {
                const userId = String(data.userId);
                const username = data.username || `User ${userId}`;

                // Only register if not already registered
                if (ws.userId === userId) {
                    console.log(`⚠️ User ${userId} already registered on this connection`);
                    return;
                }

                // Disconnect any existing session for this user
                if (activeUsers.has(userId)) {
                    const oldWs = activeUsers.get(userId);
                    if (oldWs && oldWs !== ws && oldWs.readyState === WebSocket.OPEN) {
                        console.log(`🔄 Closing old connection for user ${userId}`);
                        oldWs.close();
                    }
                }

                ws.userId = userId;
                ws.username = username;

                activeUsers.set(userId, ws);

                // Register user if new
                if (!registeredUsers.has(userId)) {
                    registeredUsers.set(userId, {
                        username,
                        createdAt: new Date()
                    });
                } else {
                    // Update username if changed
                    registeredUsers.get(userId).username = username;
                }

                userSessions.set(userId, {
                    ip,
                    username,
                    connectedAt: new Date(),
                    lastActivity: new Date()
                });

                console.log(`✅ User registered → ID: ${userId}, Username: ${username}`);

                // Send current user list to the connecting user
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: "user_list",
                        users: Array.from(registeredUsers.entries()).map(([id, data]) => ({
                            id,
                            username: data.username,
                            online: activeUsers.has(id)
                        })),
                        timestamp: Date.now()
                    }));
                }

                // Broadcast updated user list to everyone
                setTimeout(() => broadcastUserList(), 100);
                setTimeout(() => broadcastSystem(`${username} joined the chat`), 150);

                // Deliver offline messages, if any
                if (offlineMessages.has(userId)) {
                    const queued = offlineMessages.get(userId);
                    queued.forEach((msg) => {
                        if (ws.readyState === WebSocket.OPEN) {
                            ws.send(JSON.stringify(msg));
                        }
                    });
                    offlineMessages.delete(userId);
                }

                return;
            }

            // Update last activity
            if (ws.userId && userSessions.has(ws.userId)) {
                userSessions.get(ws.userId).lastActivity = new Date();
            }

            // -------------------------------------------------------
            // 2️⃣ Typing indicator
            // -------------------------------------------------------
            if (data.typing !== undefined) {
                const toId = String(data.to);
                const target = activeUsers.get(toId);

                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(
                        JSON.stringify({
                            type: "typing",
                            from: ws.userId,
                            fromUsername: ws.username,
                            to: toId,
                            typing: data.typing
                        })
                    );
                }
                return;
            }

            // -------------------------------------------------------
            // 3️⃣ User management (add/edit/delete)
            // -------------------------------------------------------
            if (data.type === "user_action") {
                // Add user
                if (data.action === "add" && data.newUser) {
                    const { id, username } = data.newUser;
                    registeredUsers.set(id, {
                        username,
                        createdAt: new Date()
                    });
                    broadcastUserList();
                    broadcastSystem(`${username} joined the chat`);
                    return;
                }

                // Edit user
                if (data.action === "edit" && data.userId && data.newUsername) {
                    const oldUsername = registeredUsers.get(data.userId)?.username;
                    if (registeredUsers.has(data.userId)) {
                        registeredUsers.get(data.userId).username = data.newUsername;
                        
                        // Update active connection username if online
                        const userWs = activeUsers.get(data.userId);
                        if (userWs) userWs.username = data.newUsername;
                        
                        broadcastUserList();
                        if (oldUsername !== data.newUsername) {
                            broadcastSystem(`${oldUsername} changed name to ${data.newUsername}`);
                        }
                    }
                    return;
                }

                // Delete user
                if (data.action === "delete" && data.userId) {
                    const userToDelete = registeredUsers.get(data.userId);
                    if (userToDelete) {
                        // Close active connection if exists
                        const userWs = activeUsers.get(data.userId);
                        if (userWs && userWs.readyState === WebSocket.OPEN) {
                            userWs.close();
                        }
                        
                        registeredUsers.delete(data.userId);
                        activeUsers.delete(data.userId);
                        offlineMessages.delete(data.userId);
                        
                        broadcastUserList();
                        broadcastSystem(`${userToDelete.username} left the chat`);
                    }
                    return;
                }
            }

            // -------------------------------------------------------
            // 4️⃣ Sending direct messages
            // -------------------------------------------------------
            if (data.text && data.to) {
                const toId = String(data.to);
                const target = activeUsers.get(toId);

                const messageId = generateMessageId();

                const payload = {
                    type: "message",
                    messageId,
                    from: ws.userId,
                    fromUsername: ws.username,
                    to: toId,
                    text: data.text,
                    timestamp: Date.now(),
                    status: target ? "delivered" : "sent"
                };

                console.log(`💬 ${ws.username} (${ws.userId}) → User ${toId}: ${data.text}`);

                // Track for read receipts
                pendingReadReceipts.set(messageId, {
                    from: ws.userId,
                    to: toId,
                    text: data.text,
                    timestamp: payload.timestamp
                });

                // Deliver or queue
                if (target && target.readyState === WebSocket.OPEN) {
                    target.send(JSON.stringify(payload));
                } else {
                    if (!offlineMessages.has(toId)) offlineMessages.set(toId, []);
                    offlineMessages.get(toId).push(payload);
                }

                // Echo back to sender with updated status
                ws.send(JSON.stringify(payload));
                return;
            }

            // -------------------------------------------------------
            // 5️⃣ Read receipts
            // -------------------------------------------------------
            if (data.type === "read_receipt" && Array.isArray(data.messageIds)) {
                data.messageIds.forEach((messageId) => {
                    if (!pendingReadReceipts.has(messageId)) return;

                    const info = pendingReadReceipts.get(messageId);

                    // Only recipient can mark as read
                    if (info.to !== ws.userId) return;

                    const senderWs = activeUsers.get(info.from);
                    if (senderWs && senderWs.readyState === WebSocket.OPEN) {
                        senderWs.send(
                            JSON.stringify({
                                type: "read_receipt",
                                messageId,
                                from: ws.userId,
                                fromUsername: ws.username,
                                to: info.from,
                                readAt: Date.now()
                            })
                        );
                    }

                    pendingReadReceipts.delete(messageId);
                });

                return;
            }

            console.log("❓ Unknown message received:", data);
        });

        // -------------------------------------------------------
        // 6️⃣ Handle disconnect
        // -------------------------------------------------------
        ws.on("close", (code, reason) => {
            console.log(`🔌 WebSocket closed - Code: ${code}, Reason: ${reason || 'None'}, User: ${ws.userId || 'Not registered'}`);
            
            if (ws.userId) {
                // Cleanup any active calls
                callHandler.cleanupUserCalls(ws.userId);

                activeUsers.delete(ws.userId);

                const username = ws.username || `User ${ws.userId}`;
                console.log(`👋 ${username} disconnected`);

                // Broadcast updated user list (shows user as offline)
                broadcastUserList();
                broadcastSystem(`${username} left the chat`);
            }
        });

        // -------------------------------------------------------
        // 7️⃣ Error handling
        // -------------------------------------------------------
        ws.on("error", (err) => {
            console.error(`❌ WS Error (${ws.userId || "unknown"}):`, err.message);
        });
    });

    // Heartbeat for dead connection removal
    setInterval(() => {
        wss.clients.forEach((ws) => {
            if (!ws.isAlive) return ws.terminate();
            ws.isAlive = false;
            ws.ping();
        });
    }, 30000);
}

module.exports = { setupWebSocketServer };