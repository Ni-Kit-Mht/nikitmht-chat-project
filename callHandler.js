// ============================================================================
// callHandler.js - Simplified WebRTC Call Handler with Extensive Logging
// ============================================================================

const WebSocket = require("ws");

// Simple configuration
const CONFIG = {
    CALL_TIMEOUT: 60000, // 60 seconds to answer
    MAX_CALL_DURATION: 4 * 60 * 60 * 1000, // 4 hours max
};

// Logging helpers
const log = {
    info: (msg, data = null) => {
        console.log(`\n📘 [INFO] ${msg}`);
        if (data) console.log('   Data:', JSON.stringify(data, null, 2));
    },
    success: (msg, data = null) => {
        console.log(`\n✅ [SUCCESS] ${msg}`);
        if (data) console.log('   Data:', JSON.stringify(data, null, 2));
    },
    error: (msg, data = null) => {
        console.log(`\n❌ [ERROR] ${msg}`);
        if (data) console.log('   Data:', JSON.stringify(data, null, 2));
    },
    warn: (msg, data = null) => {
        console.log(`\n⚠️  [WARN] ${msg}`);
        if (data) console.log('   Data:', JSON.stringify(data, null, 2));
    },
    debug: (msg, data = null) => {
        console.log(`\n🔍 [DEBUG] ${msg}`);
        if (data) console.log('   Data:', JSON.stringify(data, null, 2));
    },
    state: (msg, state) => {
        console.log(`\n📊 [STATE] ${msg}`);
        console.log('   Current State:', JSON.stringify(state, null, 2));
    }
};

class CallManager {
    constructor(wss, activeUsers, registeredUsers) {
        this.wss = wss;
        this.activeUsers = activeUsers;
        this.registeredUsers = registeredUsers;
        
        // Simple data structures
        this.activeCalls = new Map(); // callId -> call object
        this.userCallMap = new Map(); // userId -> callId
        this.callTimeouts = new Map(); // callId -> timeoutId
        
        log.success("Call handler initialized", {
            activeUsers: activeUsers.size,
            registeredUsers: registeredUsers.size
        });
    }

    // ========================================================================
    // Main Message Router
    // ========================================================================

    handleCallMessage(ws, data) {
        const userId = ws.userId;

        log.info(`Received call message`, {
            type: data.type,
            userId: userId,
            callId: data.callId || 'none'
        });

        if (!userId) {
            log.error("Message from unregistered user");
            this.sendError(ws, "User not authenticated");
            return;
        }

        // Log current state before processing
        this.logCurrentState(userId);

        // Route to handler
        const handlers = {
            call_initiate: () => this.handleCallInitiate(ws, userId, data),
            call_answer: () => this.handleCallAnswer(ws, userId, data),
            call_reject: () => this.handleCallReject(ws, userId, data),
            call_end: () => this.handleCallEnd(ws, userId, data),
            call_offer: () => this.handleCallOffer(ws, userId, data),
            call_answer_sdp: () => this.handleCallAnswerSDP(ws, userId, data),
            call_ice_candidate: () => this.handleIceCandidate(ws, userId, data),
            call_force_cleanup: () => this.handleForceCleanup(ws, userId, data)
        };

        const handler = handlers[data.type];
        if (handler) {
            try {
                handler();
            } catch (error) {
                log.error(`Exception in ${data.type} handler`, { error: error.message, stack: error.stack });
                this.sendError(ws, "Internal server error");
            }
        } else {
            log.warn(`Unknown message type: ${data.type}`);
        }
    }

    // ========================================================================
    // Call Initiation
    // ========================================================================

    handleCallInitiate(ws, fromUserId, data) {
        const toUserId = String(data.to);
        const callType = data.callType === 'audio' ? 'audio' : 'video';

        log.info(`Call initiation request`, {
            from: fromUserId,
            to: toUserId,
            callType: callType
        });

        // Validation
        if (fromUserId === toUserId) {
            log.error("Cannot call yourself");
            this.sendToUser(fromUserId, {
                type: "call_error",
                error: "Cannot call yourself"
            });
            return;
        }

        if (!this.registeredUsers.has(toUserId)) {
            log.error(`Target user not found: ${toUserId}`);
            this.sendToUser(fromUserId, {
                type: "call_error",
                error: "User not found"
            });
            return;
        }

        // Check if caller is already in a call
        const callerExistingCallId = this.userCallMap.get(fromUserId);
        if (callerExistingCallId) {
            const existingCall = this.activeCalls.get(callerExistingCallId);
            log.warn(`User ${fromUserId} already has call`, {
                existingCallId: callerExistingCallId,
                existingCallStatus: existingCall ? existingCall.status : 'deleted'
            });
            
            // Force cleanup the old call first
            log.info(`Force cleaning up stale call: ${callerExistingCallId}`);
            this.forceEndCall(callerExistingCallId, "Initiating new call");
        }

        // Check if recipient is already in a call
        const recipientExistingCallId = this.userCallMap.get(toUserId);
        if (recipientExistingCallId) {
            const existingCall = this.activeCalls.get(recipientExistingCallId);
            log.warn(`Recipient ${toUserId} already in call`, {
                existingCallId: recipientExistingCallId,
                existingCallStatus: existingCall ? existingCall.status : 'deleted'
            });
            
            this.sendToUser(fromUserId, {
                type: "call_error",
                error: "User is already in a call"
            });
            return;
        }

        // Create new call
        const callId = this.generateCallId();
        const call = {
            callId: callId,
            from: fromUserId,
            to: toUserId,
            callType: callType,
            status: 'ringing',
            createdAt: Date.now()
        };

        this.activeCalls.set(callId, call);
        this.userCallMap.set(fromUserId, callId);
        this.userCallMap.set(toUserId, callId);

        log.success(`Call created`, {
            callId: callId,
            from: fromUserId,
            to: toUserId,
            callType: callType
        });

        // Set timeout for unanswered call
        this.setCallTimeout(callId);

        // Get usernames
        const fromUsername = this.getUsernameById(fromUserId);
        const toUsername = this.getUsernameById(toUserId);

        // Notify caller
        this.sendToUser(fromUserId, {
            type: "call_initiated",
            callId: callId,
            to: toUserId,
            toUsername: toUsername,
            callType: callType
        });
        log.debug(`Sent call_initiated to ${fromUserId}`);

        // Notify recipient
        this.sendToUser(toUserId, {
            type: "call_incoming",
            callId: callId,
            from: fromUserId,
            fromUsername: fromUsername,
            callType: callType
        });
        log.debug(`Sent call_incoming to ${toUserId}`);

        this.logCurrentState(fromUserId);
    }

    // ========================================================================
    // Call Answer
    // ========================================================================

    handleCallAnswer(ws, userId, data) {
        const { callId } = data;

        log.info(`Call answer`, {
            callId: callId,
            userId: userId
        });

        const call = this.getCall(callId);
        if (!call) {
            log.error(`Call not found: ${callId}`);
            this.sendToUser(userId, {
                type: "call_error",
                error: "Call not found"
            });
            return;
        }

        if (call.to !== userId) {
            log.error(`User ${userId} is not the recipient of call ${callId}`);
            this.sendToUser(userId, {
                type: "call_error",
                error: "You are not the recipient of this call"
            });
            return;
        }

        if (call.status !== 'ringing') {
            log.warn(`Call ${callId} is not ringing (status: ${call.status})`);
            this.sendToUser(userId, {
                type: "call_error",
                error: "Call is no longer available"
            });
            return;
        }

        // Clear timeout
        this.clearCallTimeout(callId);

        // Update status
        call.status = 'connecting';
        call.answeredAt = Date.now();

        log.success(`Call answered`, {
            callId: callId,
            answeredBy: userId,
            newStatus: 'connecting'
        });

        // Notify both parties
        const answerMessage = {
            type: "call_answered",
            callId: callId
        };

        this.sendToUser(call.from, answerMessage);
        log.debug(`Sent call_answered to caller ${call.from}`);

        this.sendToUser(call.to, answerMessage);
        log.debug(`Sent call_answered to recipient ${call.to}`);
    }

    // ========================================================================
    // WebRTC Signaling
    // ========================================================================

    handleCallOffer(ws, userId, data) {
        const { callId, offer } = data;

        log.info(`Call offer`, {
            callId: callId,
            from: userId,
            offerType: offer?.type
        });

        const call = this.getCall(callId);
        if (!call) {
            log.error(`Call not found: ${callId}`);
            return;
        }

        if (call.from !== userId) {
            log.error(`User ${userId} is not the caller for ${callId}`);
            return;
        }

        if (!offer || !offer.type || !offer.sdp) {
            log.error(`Invalid offer format`, { offer });
            return;
        }

        log.success(`Forwarding offer to ${call.to}`, {
            callId: callId,
            sdpLength: offer.sdp.length
        });

        // Forward to recipient
        this.sendToUser(call.to, {
            type: "call_offer",
            callId: callId,
            offer: offer
        });
    }

// In your backend's handleCallAnswerSDP, add more logging:
handleCallAnswerSDP(ws, userId, data) {
  const { callId, answer } = data;

  log.info(`Call answer SDP received`, {
    callId: callId,
    from: userId,
    answerType: answer?.type,
    sdpLength: answer?.sdp?.length
  });

  const call = this.getCall(callId);
  if (!call) {
    log.error(`Call not found: ${callId}`);
    return;
  }

  if (call.to !== userId) {
    log.error(`User ${userId} is not the recipient for ${callId}`);
    return;
  }

  if (!answer || !answer.type || !answer.sdp) {
    log.error(`Invalid answer format`, { answer });
    return;
  }

  // Update to active
  call.status = 'active';
  call.connectedAt = Date.now();

  log.success(`Call is now active, forwarding answer to caller`, {
    callId: callId,
    status: 'active',
    callerId: call.from,
    answerType: answer.type
  });

  // Forward to caller
  const success = this.sendToUser(call.from, {
    type: "call_answer_sdp",
    callId: callId,
    answer: answer
  });

  if (success) {
    log.success(`Successfully forwarded answer to caller ${call.from}`);
  } else {
    log.error(`Failed to forward answer to caller ${call.from}`);
  }

  // Set max duration timeout
  this.setMaxDurationTimeout(callId);
}

    handleIceCandidate(ws, userId, data) {
        const { callId, candidate } = data;

        log.debug(`ICE candidate`, {
            callId: callId,
            from: userId,
            candidateType: candidate?.type
        });

        const call = this.getCall(callId);
        if (!call) {
            log.warn(`ICE candidate for non-existent call: ${callId}`);
            return;
        }

        // Forward to other party
        const recipientId = call.from === userId ? call.to : call.from;
        
        this.sendToUser(recipientId, {
            type: "call_ice_candidate",
            callId: callId,
            candidate: candidate
        });

        log.debug(`Forwarded ICE candidate to ${recipientId}`);
    }

    // ========================================================================
    // Call Termination
    // ========================================================================

    handleCallReject(ws, userId, data) {
        const { callId } = data;

        log.info(`Call rejected`, {
            callId: callId,
            rejectedBy: userId
        });

        const call = this.getCall(callId);
        if (!call) {
            log.warn(`Call not found: ${callId}`);
            return;
        }

        if (call.to !== userId) {
            log.error(`User ${userId} cannot reject call ${callId}`);
            return;
        }

        this.endCall(callId, "rejected");
    }

    handleCallEnd(ws, userId, data) {
        const { callId } = data;

        log.info(`Call end request`, {
            callId: callId,
            requestedBy: userId
        });

        const call = this.getCall(callId);
        if (!call) {
            log.warn(`Call not found: ${callId}`);
            return;
        }

        if (call.from !== userId && call.to !== userId) {
            log.error(`User ${userId} is not part of call ${callId}`);
            return;
        }

        this.endCall(callId, "ended");
    }

    handleForceCleanup(ws, userId, data) {
        log.warn(`Force cleanup requested by user ${userId}`);

        const existingCallId = this.userCallMap.get(userId);
        if (existingCallId) {
            log.info(`Force cleaning up call: ${existingCallId}`);
            this.forceEndCall(existingCallId, "Force cleanup requested");
        } else {
            log.info(`No active call found for user ${userId}`);
        }

        // Always send confirmation
        this.sendToUser(userId, {
            type: "call_cleanup_complete",
            userId: userId
        });

        this.logCurrentState(userId);
    }

    endCall(callId, reason = "ended") {
        const call = this.getCall(callId);
        if (!call) {
            log.warn(`Attempted to end non-existent call: ${callId}`);
            return;
        }

        log.info(`Ending call`, {
            callId: callId,
            reason: reason,
            from: call.from,
            to: call.to,
            status: call.status
        });

        // Clear timeouts
        this.clearCallTimeout(callId);

        // Update status
        call.status = 'ended';
        call.endedAt = Date.now();
        call.endReason = reason;

        if (call.connectedAt) {
            call.duration = call.endedAt - call.connectedAt;
            log.info(`Call duration: ${Math.round(call.duration / 1000)}s`);
        }

        // Notify both parties
        const endMessage = {
            type: reason === "rejected" ? "call_rejected" : "call_ended",
            callId: callId,
            reason: reason
        };

        this.sendToUser(call.from, endMessage);
        log.debug(`Sent end notification to ${call.from}`);

        this.sendToUser(call.to, endMessage);
        log.debug(`Sent end notification to ${call.to}`);

        // Cleanup mappings
        this.userCallMap.delete(call.from);
        this.userCallMap.delete(call.to);

        log.success(`Call cleanup complete`, {
            callId: callId,
            userCallMapSize: this.userCallMap.size,
            activeCallsSize: this.activeCalls.size
        });

        // Remove call after delay (for debugging)
        setTimeout(() => {
            this.activeCalls.delete(callId);
            log.debug(`Removed call from activeCalls: ${callId}`);
        }, 5000);

        this.logCurrentState(call.from);
    }

    forceEndCall(callId, reason = "forced") {
        log.warn(`Force ending call: ${callId}`, { reason });
        
        const call = this.getCall(callId);
        if (!call) {
            log.warn(`Call already removed: ${callId}`);
            return;
        }

        // Clear everything immediately
        this.clearCallTimeout(callId);
        this.userCallMap.delete(call.from);
        this.userCallMap.delete(call.to);
        this.activeCalls.delete(callId);

        // Notify both parties
        const endMessage = {
            type: "call_ended",
            callId: callId,
            reason: reason
        };

        this.sendToUser(call.from, endMessage);
        this.sendToUser(call.to, endMessage);

        log.success(`Force cleanup complete for ${callId}`);
    }

    // ========================================================================
    // User Disconnection
    // ========================================================================

    cleanupUserCalls(userId) {
        log.info(`User disconnected, cleaning up calls`, { userId });

        const callId = this.userCallMap.get(userId);
        if (callId) {
            log.info(`Found active call for disconnected user`, {
                userId: userId,
                callId: callId
            });
            
            this.endCall(callId, "disconnected");
        } else {
            log.debug(`No active calls for user ${userId}`);
        }
    }

    // ========================================================================
    // Helper Methods
    // ========================================================================

    generateCallId() {
        return `call-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    getCall(callId) {
        return this.activeCalls.get(callId);
    }

    getUsernameById(userId) {
        return this.registeredUsers.get(userId)?.username || `User ${userId}`;
    }

    setCallTimeout(callId) {
        log.debug(`Setting call timeout: ${callId} (${CONFIG.CALL_TIMEOUT}ms)`);
        
        const timeoutId = setTimeout(() => {
            const call = this.getCall(callId);
            if (call && call.status === 'ringing') {
                log.warn(`Call timeout reached: ${callId}`);
                this.endCall(callId, "timeout");
            }
        }, CONFIG.CALL_TIMEOUT);

        this.callTimeouts.set(callId, timeoutId);
    }

    setMaxDurationTimeout(callId) {
        log.debug(`Setting max duration timeout: ${callId}`);
        
        const timeoutId = setTimeout(() => {
            const call = this.getCall(callId);
            if (call && call.status === 'active') {
                log.warn(`Max duration reached: ${callId}`);
                this.endCall(callId, "max_duration");
            }
        }, CONFIG.MAX_CALL_DURATION);

        this.clearCallTimeout(callId);
        this.callTimeouts.set(callId, timeoutId);
    }

    clearCallTimeout(callId) {
        const timeoutId = this.callTimeouts.get(callId);
        if (timeoutId) {
            clearTimeout(timeoutId);
            this.callTimeouts.delete(callId);
            log.debug(`Cleared timeout for call: ${callId}`);
        }
    }

    sendToUser(userId, payload) {
        const userWs = this.activeUsers.get(userId);
        
        if (!userWs) {
            log.warn(`Cannot send to ${userId} - not in activeUsers`);
            return false;
        }

        if (userWs.readyState !== WebSocket.OPEN) {
            log.warn(`Cannot send to ${userId} - WebSocket not open (state: ${userWs.readyState})`);
            return false;
        }

        try {
            userWs.send(JSON.stringify(payload));
            log.debug(`Sent message to ${userId}`, { type: payload.type });
            return true;
        } catch (error) {
            log.error(`Failed to send to ${userId}`, { error: error.message });
            return false;
        }
    }

    sendError(ws, error) {
        if (ws && ws.readyState === WebSocket.OPEN) {
            try {
                ws.send(JSON.stringify({
                    type: "call_error",
                    error: error
                }));
            } catch (e) {
                log.error("Failed to send error message", { error: e.message });
            }
        }
    }

    // ========================================================================
    // Debugging & State Inspection
    // ========================================================================

    logCurrentState(userId = null) {
        const state = {
            timestamp: new Date().toISOString(),
            totalActiveCalls: this.activeCalls.size,
            totalUserCallMappings: this.userCallMap.size,
            activeCalls: [],
            userMappings: []
        };

        // Log all active calls
        for (const [callId, call] of this.activeCalls.entries()) {
            state.activeCalls.push({
                callId: callId,
                from: call.from,
                to: call.to,
                status: call.status,
                callType: call.callType,
                createdAt: call.createdAt
            });
        }

        // Log all user mappings
        for (const [user, callId] of this.userCallMap.entries()) {
            state.userMappings.push({
                userId: user,
                callId: callId
            });
        }

        if (userId) {
            state.focusUser = userId;
            state.focusUserCallId = this.userCallMap.get(userId) || null;
        }

        log.state("Current Call System State", state);
    }

    getStats() {
        const stats = {
            activeCalls: this.activeCalls.size,
            userCallMappings: this.userCallMap.size,
            activeTimeouts: this.callTimeouts.size,
            calls: []
        };

        for (const [callId, call] of this.activeCalls.entries()) {
            stats.calls.push({
                callId: callId,
                from: this.getUsernameById(call.from),
                to: this.getUsernameById(call.to),
                status: call.status,
                callType: call.callType,
                duration: call.connectedAt ? Date.now() - call.connectedAt : 0
            });
        }

        return stats;
    }
}

// ============================================================================
// Factory Function
// ============================================================================

function setupCallHandler(wss, activeUsers, registeredUsers) {
    const callManager = new CallManager(wss, activeUsers, registeredUsers);

    return {
        handleCallMessage: (ws, data) => callManager.handleCallMessage(ws, data),
        cleanupUserCalls: (userId) => callManager.cleanupUserCalls(userId),
        getStats: () => callManager.getStats(),
        logState: (userId) => callManager.logCurrentState(userId)
    };
}

module.exports = { setupCallHandler };