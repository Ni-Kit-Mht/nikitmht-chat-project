import React, { useEffect, useRef, useState } from 'react';
import './CallUsers.css';

interface CallUsersProps {
  ws: WebSocket | null;
  currentUserId: string;
  users: Array<{ id: string; username: string; online: boolean }>;
}

const CallUsers: React.FC<CallUsersProps> = ({ ws, currentUserId, users }) => {
  // Call state
  const [callId, setCallId] = useState<string | null>(null);
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'incoming' | 'active'>('idle');
  const [callType, setCallType] = useState<'audio' | 'video'>('video');
  const [remotePeer, setRemotePeer] = useState<{ id: string; name: string } | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [iceConnectionState, setIceConnectionState] = useState<string>('new');
  const [callAccepted, setCallAccepted] = useState(false);
  
  // Refs for WebRTC
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const wsRef = useRef(ws);
  const pendingOfferRef = useRef<any>(null);
  const pendingIceCandidatesRef = useRef<any[]>([]);

  // Update ws ref when ws changes
  useEffect(() => {
    wsRef.current = ws;
  }, [ws]);

  const log = (msg: string, data?: any) => {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    console.log(`📞 [${timestamp}] ${msg}`, data || '');
  };

  // State change logger
  useEffect(() => {
    log('State changed', { 
      callStatus, 
      callId, 
      remotePeer,
      iceConnectionState,
      callDuration,
      callAccepted 
    });
  }, [callStatus, callId, remotePeer, iceConnectionState, callDuration, callAccepted]);

  // Call timer
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    
    if (callStatus === 'active') {
      interval = setInterval(() => {
        setCallDuration(prev => prev + 1);
      }, 1000);
    } else {
      setCallDuration(0);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [callStatus]);

  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Track ICE connection state
  useEffect(() => {
    if (!peerConnectionRef.current) return;
    
    const pc = peerConnectionRef.current;
    
    const handleIceStateChange = () => {
      log('ICE connection state changed:', pc.iceConnectionState);
      setIceConnectionState(pc.iceConnectionState);
      
      if (pc.iceConnectionState === 'connected') {
        log('Peer connection established');
      } else if (pc.iceConnectionState === 'disconnected' || 
                pc.iceConnectionState === 'failed') {
        log('Peer connection lost');
        cleanup();
      }
    };
    
    pc.addEventListener('iceconnectionstatechange', handleIceStateChange);
    
    return () => {
      pc.removeEventListener('iceconnectionstatechange', handleIceStateChange);
    };
  }, [peerConnectionRef.current]);

// WebSocket message handler - FIXED
useEffect(() => {
  if (!ws) return;

  const handleMessage = async (event: MessageEvent) => {
    const data = JSON.parse(event.data);
    log('📥 INCOMING MESSAGE:', { 
      type: data.type, 
      callId: data.callId,
      timestamp: new Date().toISOString()
    });

    try {
      switch (data.type) {
        case 'call_initiated':
          setCallId(data.callId);
          log('💡 Call initiated, waiting for acceptance...');
          break;

        case 'call_incoming':
          log('📲 INCOMING CALL RECEIVED!');
          setCallId(data.callId);
          setCallStatus('incoming');
          setCallType(data.callType);
          setRemotePeer({ 
            id: data.from, 
            name: data.fromUsername || data.from 
          });
          break;

        case 'call_answered':  // CHANGED: Backend sends 'call_answered' (not 'call_accepted')
          log('✅ REMOTE ACCEPTED OUR CALL!');
          setCallAccepted(true);
          
          // If we're the caller, setup caller
          if (callStatus === 'calling') {
            log('⚙️ We are the caller, setting up...');
            await setupCaller();
          }
          break;

        case 'call_offer':
  log('📝 Received SDP offer from caller');
  if (data.offer) {
    // Store the offer
    pendingOfferRef.current = data.offer;
    
    // If we're in incoming state (we answered), process it
    if (callStatus === 'incoming') {
      log('Processing offer as answerer...');
      await processOffer(data.offer, data.callId);
    } else {
      log('Offer received but not in incoming state. Current state:', callStatus);
    }
  }
  break;

        case 'call_answer_sdp':
  log('🎯 RECEIVED SDP ANSWER from remote!');
  
  if (peerConnectionRef.current && data.answer) {
    try {
      log('Setting remote description with answer...');
      await peerConnectionRef.current.setRemoteDescription(
        new RTCSessionDescription(data.answer)
      );
      log('✅ Remote description set');
      // DO NOT set callStatus to active here
      // Wait for ICE connection state change
    } catch (error) {
      log('❌ Failed to set remote description:', error);
      cleanup();
    }
  } else {
    log('❌ No peer connection or answer to process');
  }
  break;

        case 'call_rejected':
          log('❌ Call rejected by remote');
          alert(`${remotePeer?.name || 'User'} rejected the call`);
          cleanup();
          break;

        case 'call_ended':
          log('📴 Call ended by remote');
          alert(`${remotePeer?.name || 'User'} ended the call`);
          cleanup();
          break;

        case 'call_error':
          alert(`Call error: ${data.error}`);
          cleanup();
          break;
        case 'call_ice_candidate':
  log('🧊 Received ICE candidate from remote');
  
  if (peerConnectionRef.current && data.candidate) {
    try {
      log('Adding ICE candidate:', {
        type: data.candidate.type,
        candidate: data.candidate.candidate?.substring(0, 100) + '...'
      });
      
      await peerConnectionRef.current.addIceCandidate(
        new RTCIceCandidate(data.candidate)
      );
      
      log('✅ ICE candidate added successfully');
    } catch (error) {
      log('❌ Failed to add ICE candidate:', error);
      // Don't cleanup on ICE candidate errors - they're common
    }
  } else {
    log('⚠️ No peer connection or candidate to add');
  }
  break;
      }
    } catch (error) {
      log('❌ Error handling message', error);
    }
  };

  ws.addEventListener('message', handleMessage);
  return () => ws.removeEventListener('message', handleMessage);
}, [ws, callStatus, callId, callAccepted]);
  // Send message helper
  const send = (message: any) => {
    if (!wsRef.current) {
      log('No WebSocket connection');
      return;
    }
    
    if (wsRef.current.readyState === WebSocket.OPEN) {
      const msgWithFrom = {
        ...message,
        from: currentUserId,
        fromUsername: users.find(u => u.id === currentUserId)?.username
      };
      wsRef.current.send(JSON.stringify(msgWithFrom));
      log('Sent:', msgWithFrom.type);
    } else {
      log('WebSocket not open', wsRef.current.readyState);
    }
  };

  // Setup peer connection for caller - FIXED
const setupCaller = async () => {
  try {
    log('Setting up as caller');
    if (!callId) {
      throw new Error('No call ID');
    }

    const stream = await getMedia();
    const pc = createPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: callType === 'video'
    });
    await pc.setLocalDescription(offer);
    
    send({ 
      type: 'call_offer', 
      callId, 
      offer: pc.localDescription,
      to: remotePeer?.id 
    });
    
    log('Call offer sent, waiting for answer...');
    
    // Listen for ICE connection
    pc.addEventListener('iceconnectionstatechange', () => {
      if (pc.iceConnectionState === 'connected') {
        log('✅ ICE connection established!');
        setCallStatus('active');
      } else if (pc.iceConnectionState === 'failed' || pc.iceConnectionState === 'disconnected') {
        log('❌ ICE connection failed');
        cleanup();
      }
    });
    
  } catch (error) {
    log('Setup caller error', error);
    alert('Failed to start call. Please check your camera/microphone permissions.');
    cleanup();
  }
};

// In processOffer function, add more logging:
const processOffer = async (offer: any, callId: string) => {
  try {
    log('Processing SDP offer as answerer');
    const stream = await getMedia();
    const pc = createPeerConnection();
    stream.getTracks().forEach(track => pc.addTrack(track, stream));
    
    log('Setting remote description with offer');
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    log('Creating answer');
    const answer = await pc.createAnswer();
    log('Created answer:', { 
      type: answer.type,
      sdpPreview: answer.sdp?.substring(0, 200) + '...' 
    });
    
    await pc.setLocalDescription(answer);
    
    // Test: Log what we're about to send
    log('Sending SDP answer to backend:', {
      callId,
      answerType: answer.type,
      sdpLength: answer.sdp?.length
    });
    
    send({ 
      type: 'call_answer_sdp', 
      callId, 
      answer: pc.localDescription 
    });
    
    log('✅ SDP answer sent to backend');
    
    // Wait for connection
    log('Waiting for ICE connection...');
    
  } catch (error) {
    log('❌ Process offer error', error);
    cleanup();
  }
};

const testAudioPlayback = () => {
  if (!remoteVideoRef.current?.srcObject) {
    log('❌ No remote stream to test');
    return;
  }
  
  const stream = remoteVideoRef.current.srcObject as MediaStream;
  const audioTracks = stream.getAudioTracks();
  
  if (audioTracks.length === 0) {
    log('❌ No audio tracks in remote stream');
    return;
  }
  
  log('🔊 Remote audio tracks:', audioTracks.map(t => ({
    id: t.id,
    enabled: t.enabled,
    muted: t.muted,
    readyState: t.readyState
  })));
  
  // Create a temporary audio element to test
  const testAudio = new Audio();
  testAudio.srcObject = new MediaStream([audioTracks[0]]);
  testAudio.volume = 1.0;
  
  testAudio.oncanplay = () => {
    log('✅ Test audio can play');
    testAudio.play().then(() => {
      log('▶️ Test audio playing');
      setTimeout(() => {
        testAudio.pause();
        log('⏸️ Test audio stopped');
      }, 3000);
    }).catch(e => {
      log('❌ Test audio play failed:', e);
    });
  };
  
  testAudio.onerror = (e) => {
    log('❌ Test audio error:', e);
  };
};

const getConnectionStats = async () => {
  if (!peerConnectionRef.current) return;
  
  const pc = peerConnectionRef.current;
  const stats = await pc.getStats();
  
  log('📊 CONNECTION STATISTICS:');
  
  stats.forEach(report => {
    if (report.type === 'inbound-rtp' && report.kind === 'audio') {
      log('🔊 INBOUND AUDIO:', {
        packetsReceived: report.packetsReceived,
        bytesReceived: report.bytesReceived,
        jitter: report.jitter,
        packetsLost: report.packetsLost
      });
    }
    
    if (report.type === 'outbound-rtp' && report.kind === 'audio') {
      log('📤 OUTBOUND AUDIO:', {
        packetsSent: report.packetsSent,
        bytesSent: report.bytesSent
      });
    }
    
    if (report.type === 'candidate-pair' && report.state === 'succeeded') {
      log('🔗 CANDIDATE PAIR (SUCCESS):', {
        localCandidateId: report.localCandidateId,
        remoteCandidateId: report.remoteCandidateId,
        bytesSent: report.bytesSent,
        bytesReceived: report.bytesReceived
      });
    }
  });
};

// Call this after connection is established
useEffect(() => {
  if (iceConnectionState === 'connected') {
    getConnectionStats();
    
    // Continue monitoring
    const interval = setInterval(getConnectionStats, 5000);
    return () => clearInterval(interval);
  }
}, [iceConnectionState]);

// Add these debug buttons to your active call UI
const DebugPanel = () => {
  return (
    <div className="debug-panel" style={{
      position: 'absolute',
      top: '10px',
      right: '10px',
      background: 'rgba(0,0,0,0.7)',
      padding: '10px',
      borderRadius: '5px',
      zIndex: 1000
    }}>
      <h4 style={{color: 'white', margin: '0 0 10px 0'}}>🔧 Debug</h4>
      <div style={{display: 'flex', flexDirection: 'column', gap: '5px'}}>
        <button 
          onClick={testAudioPlayback}
          style={{padding: '5px', fontSize: '12px'}}
          disabled={!remoteVideoRef.current?.srcObject}
        >
          Test Remote Audio
        </button>
        <button 
          onClick={getConnectionStats}
          style={{padding: '5px', fontSize: '12px'}}
          disabled={!peerConnectionRef.current}
        >
          Get Stats
        </button>
      </div>
    </div>
  );
};

  // Answer call - FIXED
const answerCall = async () => {
  try {
    log('====== ANSWER CALL CLICKED ======');
    
    if (!callId) {
      alert('No call ID found');
      return;
    }
    
    log('Sending call_answer to backend');
    
    // Send acceptance to backend
    send({ 
      type: 'call_answer', 
      callId,
      to: remotePeer?.id
    });
    
    log('call_answer sent, waiting for offer from caller...');
    // DO NOT process offer here, wait for it to arrive via WebSocket
    
    // Start a timeout to detect if no offer arrives
    setTimeout(() => {
      if (!pendingOfferRef.current) {
        log('WARNING: No offer received after 3 seconds');
        alert('No offer received from caller. The call may have failed.');
      }
    }, 3000);
    
  } catch (error) {
    log('Answer call error', error);
    alert('Failed to answer call');
    cleanup();
  }
};

  // Get media stream
const getMedia = async () => {
  try {
    const constraints = {
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 2
      },
      video: callType === 'video' ? {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
        frameRate: { ideal: 30 }
      } : false
    };
    
    log('🎤 Requesting media with constraints:', constraints);
    
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    
    // Log stream details
    log('✅ Media stream obtained:', {
      id: stream.id,
      active: stream.active,
      audioTracks: stream.getAudioTracks().length,
      videoTracks: stream.getVideoTracks().length
    });
    
    // Log each track
    stream.getAudioTracks().forEach((track, i) => {
      log(`🔊 Audio Track ${i}:`, {
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        muted: track.muted,
        readyState: track.readyState,
        label: track.label
      });
      
      // Test audio locally
      if (typeof AudioContext !== 'undefined') {
        const audioContext = new AudioContext();
        const source = audioContext.createMediaStreamSource(new MediaStream([track]));
        const analyser = audioContext.createAnalyser();
        source.connect(analyser);
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(dataArray);
        
        const volume = dataArray.reduce((a, b) => a + b) / dataArray.length;
        log(`📊 Audio level: ${volume.toFixed(2)}`);
        
        audioContext.close();
      }
    });
    
    stream.getVideoTracks().forEach((track, i) => {
      log(`🎥 Video Track ${i}:`, {
        id: track.id,
        kind: track.kind,
        enabled: track.enabled,
        readyState: track.readyState,
        label: track.label
      });
    });
    
    localStreamRef.current = stream;
    
    if (localVideoRef.current && callType === 'video') {
      localVideoRef.current.srcObject = stream;
      localVideoRef.current.onloadedmetadata = () => {
        log('📹 Local video ready');
      };
      localVideoRef.current.play().catch(e => log('Local video play error:', e));
    }
    
    return stream;
  } catch (error) {
    log('❌ Failed to get media:', error);
    
    // Try audio-only as fallback
    if (callType === 'video') {
      log('🔄 Trying audio-only as fallback...');
      try {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        log('✅ Got audio-only stream');
        return audioStream;
      } catch (audioError) {
        log('❌ Failed to get audio too:', audioError);
      }
    }
    
    throw error;
  }
};

  // Create peer connection
// Enhanced createPeerConnection with better debugging
const createPeerConnection = () => {
  log('🎬 Creating new peer connection');
  const pc = new RTCPeerConnection({
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  });

  // Track added tracks
  pc.addEventListener('track', (event) => {
    log('🎬 REMOTE TRACK ADDED:', {
      kind: event.track.kind,
      trackId: event.track.id,
      streamId: event.streams[0]?.id,
      enabled: event.track.enabled,
      muted: event.track.muted,
      readyState: event.track.readyState
    });
    
    // Check if this is an audio track
    if (event.track.kind === 'audio') {
      log('🔊 REMOTE AUDIO TRACK DETECTED - should hear audio now');
      
      // Create an audio element to test
      const audioElement = new Audio();
      audioElement.srcObject = event.streams[0];
      audioElement.volume = 1.0;
      
      audioElement.oncanplay = () => {
        log('🎵 Remote audio can play');
        audioElement.play().catch(e => log('Audio play error:', e));
      };
      
      audioElement.onerror = (e) => {
        log('❌ Remote audio error:', e);
      };
    }
    
    if (remoteVideoRef.current && event.streams[0]) {
      remoteVideoRef.current.srcObject = event.streams[0];
      
      remoteVideoRef.current.onloadedmetadata = () => {
        log('✅ Remote video metadata loaded');
      };
      
      remoteVideoRef.current.oncanplay = () => {
        log('▶️ Remote video can play');
      };
    }
  });

  // Log transceiver events
  pc.addEventListener('negotiationneeded', () => {
    log('🤝 Negotiation needed');
  });

  // Log connection state
  pc.addEventListener('connectionstatechange', () => {
    log('🔌 Connection state:', pc.connectionState);
    
    if (pc.connectionState === 'connected') {
      log('🎉 PEER CONNECTION CONNECTED - media should flow now!');
      
      // Log all transceivers
      pc.getTransceivers().forEach((transceiver, index) => {
        log(`📡 Transceiver ${index}:`, {
          kind: transceiver.receiver?.track?.kind || transceiver.sender?.track?.kind,
          direction: transceiver.direction,
          currentDirection: transceiver.currentDirection,
          receiverTrack: transceiver.receiver?.track?.enabled,
          senderTrack: transceiver.sender?.track?.enabled
        });
      });
    }
  });
  // Enhanced ICE candidate logging
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      log('🧊 Generated ICE candidate:', {
        type: e.candidate.type,
        protocol: e.candidate.protocol,
        address: e.candidate.address,
        port: e.candidate.port,
      });
      
      if (callId) {
        send({ 
          type: 'call_ice_candidate', 
          callId, 
          candidate: e.candidate 
        });
      }
    } else {
      log('🧊 ICE gathering complete - no more candidates');
    }
  };

  // Enhanced ICE connection state tracking
  pc.oniceconnectionstatechange = () => {
    log('❄️ ICE Connection State Changed:', pc.iceConnectionState);
    setIceConnectionState(pc.iceConnectionState);
    
    switch(pc.iceConnectionState) {
      case 'checking':
        log('🔍 Checking ICE candidates...');
        break;
      case 'connected':
        log('✅✅✅ ICE CONNECTED! Call is now active!');
        setCallStatus('active');
        break;
      case 'completed':
        log('🏁 ICE completed');
        break;
      case 'failed':
        log('❌ ICE failed - connection cannot be established');
        alert('Failed to establish connection. Please check your network.');
        cleanup();
        break;
      case 'disconnected':
        log('📴 ICE disconnected');
        break;
      case 'closed':
        log('🚫 ICE closed');
        break;
    }
  };

  // Track connection state
  pc.onconnectionstatechange = () => {
    log('🔌 Connection State:', pc.connectionState);
  };

  // Track signaling state
  pc.onsignalingstatechange = () => {
    log('📡 Signaling State:', pc.signalingState);
  };

  // Track ICE gathering state
  pc.onicegatheringstatechange = () => {
    log('🧊 ICE Gathering State:', pc.iceGatheringState);
  };

  pc.ontrack = (e) => {
    log('🎬 Received remote track:', {
      kind: e.track.kind,
      streamId: e.streams[0]?.id,
      trackId: e.track.id
    });
    
    if (remoteVideoRef.current && e.streams[0]) {
      remoteVideoRef.current.srcObject = e.streams[0];
      log('📹 Remote video stream attached to video element');
    }
  };

  // Log when tracks are added locally
  pc.onnegotiationneeded = () => {
    log('🤝 Negotiation needed');
  };

  // Process any pending ICE candidates that arrived before PC was created
  if (pendingIceCandidatesRef.current.length > 0) {
    log(`🔄 Processing ${pendingIceCandidatesRef.current.length} pending ICE candidates`);
    pendingIceCandidatesRef.current.forEach(async (candidate) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
        log('✅ Added pending ICE candidate');
      } catch (error) {
        log('❌ Failed to add pending ICE candidate:', error);
      }
    });
    pendingIceCandidatesRef.current = [];
  }

  peerConnectionRef.current = pc;
  return pc;
};

  // Initiate call - FIXED
  const initiateCall = (userId: string, type: 'audio' | 'video') => {
    const user = users.find(u => u.id === userId);
    if (!user || !user.online) {
      alert('User is not available');
      return;
    }

    log('Initiating call to:', user.username);
    setCallStatus('calling');
    setCallType(type);
    setRemotePeer({ id: userId, name: user.username });
    setCallAccepted(false);
    
    send({ 
      type: 'call_initiate', 
      to: userId, 
      callType: type
    });
  };

  // Reject call
  const rejectCall = () => {
    log('Rejecting call');
    send({ type: 'call_reject', callId });
    cleanup();
  };

  // End call
  const endCall = () => {
    log('Ending call');
    send({ type: 'call_end', callId });
    cleanup();
  };

  // Cleanup everything
  const cleanup = () => {
    log('Cleanup started');
    
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localStreamRef.current = null;
    }
    
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    
    setCallId(null);
    setCallStatus('idle');
    setRemotePeer(null);
    setIsMuted(false);
    setIsVideoOff(false);
    setCallDuration(0);
    setIceConnectionState('new');
    setCallAccepted(false);
    pendingOfferRef.current = null;
    
    log('Cleanup completed');
  };

  // Toggle mute
  const toggleMute = () => {
    if (!localStreamRef.current) return;
    
    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length > 0) {
      const newState = !audioTracks[0].enabled;
      audioTracks.forEach(track => {
        track.enabled = newState;
      });
      setIsMuted(!newState);
    }
  };

  // Toggle video
  const toggleVideo = () => {
    if (!localStreamRef.current || callType !== 'video') return;
    
    const videoTracks = localStreamRef.current.getVideoTracks();
    if (videoTracks.length > 0) {
      const newState = !videoTracks[0].enabled;
      videoTracks.forEach(track => {
        track.enabled = newState;
      });
      setIsVideoOff(!newState);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      log('Component unmounting');
      cleanup();
    };
  }, []);

  // Idle state
  if (callStatus === 'idle') {
    return (
      <div className="call-users-container">
        <h3>Start a Call</h3>
        <div className="call-buttons">
          {users
            .filter(u => u.id !== currentUserId && u.online)
            .map(user => (
              <div key={user.id} className="user-call-controls">
                <span className="user-name">{user.username}</span>
                <button 
                  onClick={() => initiateCall(user.id, 'video')} 
                  className="call-btn video-call"
                >
                  🎥 Video
                </button>
                <button 
                  onClick={() => initiateCall(user.id, 'audio')} 
                  className="call-btn audio-call"
                >
                  📞 Audio
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  }

  // Calling state - SHOWS WAITING FOR ACCEPTANCE
  if (callStatus === 'calling') {
    return (
      <div className="call-popup">
        <div className="call-overlay" />
        <div className="call-container">
          <div className="calling-state">
            <div className="caller-avatar">
              {remotePeer?.name?.charAt(0).toUpperCase()}
            </div>
            <h2>{remotePeer?.name}</h2>
            <p>
              {callAccepted ? 'Call accepted! Connecting...' : 'Calling...'}
            </p>
            <div className="calling-info">
              <span className="call-type">{callType === 'video' ? 'Video Call' : 'Audio Call'}</span>
              <span className="call-status">
                {callAccepted ? 'Accepted ✓' : 'Waiting for answer...'}
              </span>
            </div>
            <button onClick={endCall} className="cancel-btn">
              Cancel Call
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Incoming call state
  if (callStatus === 'incoming') {
    return (
      <div className="call-popup">
        <div className="call-overlay" />
        <div className="call-container">
          <div className="incoming-call">
            <div className="incoming-avatar">
              {remotePeer?.name?.charAt(0).toUpperCase()}
            </div>
            <h2>{remotePeer?.name}</h2>
            <p>Incoming {callType === 'video' ? 'Video' : 'Audio'} Call...</p>
            <div className="call-actions">
              <button onClick={answerCall} className="answer-btn">
                Answer
              </button>
              <button onClick={rejectCall} className="decline-btn">
                Decline
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="call-popup">
      <div className="call-overlay" />
      <div className="call-container">
        <DebugPanel />
        <div className="active-call">
          <div className="call-header">

            <span className="remote-name">{remotePeer?.name}</span>
            <span className="call-duration">{formatDuration(callDuration)}</span>
            <span className={`call-type-badge ${callType}`}>
              {callType === 'video' ? '📹 Video' : '🎧 Audio'}
            </span>
          </div>

          <div className="video-container">
            {callType === 'video' ? (
              <>
                <video 
                  ref={remoteVideoRef} 
                  autoPlay 
                  playsInline 
                  className="remote-video"
                />
                
                {(!remoteVideoRef.current?.srcObject || iceConnectionState !== 'connected') && (
                  <div className="video-placeholder">
                    <div className="placeholder-avatar">
                      {remotePeer?.name?.charAt(0).toUpperCase()}
                    </div>
                    <p>
                      {iceConnectionState === 'checking' ? 'Connecting...' : 
                       iceConnectionState === 'connected' ? 'Connected' : 
                       'Connecting video...'}
                    </p>
                  </div>
                )}
                
                {localStreamRef.current && (
                  <video 
                    ref={localVideoRef} 
                    autoPlay 
                    playsInline 
                    muted 
                    className="local-video"
                  />
                )}
              </>
            ) : (
              <div className="audio-call-ui">
                <div className="audio-avatar">
                  {remotePeer?.name?.charAt(0).toUpperCase()}
                </div>
                <p className="audio-status">Audio call in progress</p>
              </div>
            )}
          </div>

          <div className="call-controls">
            <button 
              onClick={toggleMute} 
              className={`control-btn ${isMuted ? 'muted' : ''}`}
            >
              {isMuted ? '🔇' : '🔊'}
              <span className="btn-label">{isMuted ? 'Unmute' : 'Mute'}</span>
            </button>
            
            {callType === 'video' && (
              <button 
                onClick={toggleVideo} 
                className={`control-btn ${isVideoOff ? 'video-off' : ''}`}
              >
                {isVideoOff ? '📷' : '🎥'}
                <span className="btn-label">{isVideoOff ? 'Camera On' : 'Camera Off'}</span>
              </button>
            )}
            
            <button onClick={endCall} className="control-btn end-call">
              📞
              <span className="btn-label">End Call</span>
            </button>
          </div>
          
          <div className="connection-status-indicator">
            <span className={`status-dot ${
              iceConnectionState === 'connected' ? 'connected' :
              iceConnectionState === 'checking' ? 'connecting' :
              'disconnected'
            }`} />
            <span className="status-text">
              {iceConnectionState === 'connected' ? 'Connected' :
               iceConnectionState === 'checking' ? 'Connecting...' :
               iceConnectionState === 'disconnected' ? 'Disconnected' :
               iceConnectionState}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CallUsers;