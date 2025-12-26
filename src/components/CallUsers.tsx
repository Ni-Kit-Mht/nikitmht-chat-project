import React, { useEffect, useRef, useState } from 'react';
import './CallUsers.css';

interface DeviceInfo {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
}

interface CallUsersProps {
  ws: WebSocket | null;
  currentUserId: string;
  users: Array<{ id: string; username: string; online: boolean }>;
  callState: {
    callId: string | null;
    status: 'idle' | 'calling' | 'incoming' | 'active' | 'reconnecting' | 'ending';
    callType: 'audio' | 'video';
    remoteUserId: string | null;
    remoteUsername: string | null;
    isPeerDisconnected?: boolean;
    reconnectAttempts?: number;
  };
  updateCallState: (state: Partial<{
    callId: string | null;
    status: 'idle' | 'calling' | 'incoming' | 'active' | 'reconnecting' | 'ending';
    callType: 'audio' | 'video';
    remoteUserId: string | null;
    remoteUsername: string | null;
    isPeerDisconnected?: boolean;
    reconnectAttempts?: number;
    isMuted?: boolean;
    isVideoOff?: boolean;
  }>) => void;
  resetCallState: () => void;
  sendMessage: (message: any, retries?: number) => boolean;
}

const CallUsers: React.FC<CallUsersProps> = ({ 
  ws, 
  currentUserId, 
  users, 
  callState, 
  updateCallState,
  resetCallState,
  sendMessage
}) => {
  // Device management state
  const [availableDevices, setAvailableDevices] = useState<DeviceInfo[]>([]);
  const [selectedAudioDeviceId, setSelectedAudioDeviceId] = useState<string>('');
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState<string>('');
  
  const [callDuration, setCallDuration] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [isVideoOff, setIsVideoOff] = useState<boolean>(false);
  const [debugLog, setDebugLog] = useState<string[]>([]);
  
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isCleaningUpRef = useRef<boolean>(false);
  const pendingIceCandidatesRef = useRef<RTCIceCandidateInit[]>([]);

  // ICE servers configuration
  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
    ],
  };

  // Debug logger
  const addDebugLog = (message: string) => {
    const timestamp = new Date().toLocaleTimeString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(`🔍 ${logMessage}`);
    setDebugLog(prev => [...prev.slice(-20), logMessage]); // Keep last 20 logs
  };

  // List available devices
  const enumerateDevices = async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const deviceInfos = devices.map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Unknown ${d.kind}`,
        kind: d.kind,
      }));
      
      setAvailableDevices(deviceInfos);
      
      // Set default devices if not already selected
      const audioDevices = deviceInfos.filter(d => d.kind === 'audioinput');
      const videoDevices = deviceInfos.filter(d => d.kind === 'videoinput');
      
      if (audioDevices.length > 0 && !selectedAudioDeviceId) {
        setSelectedAudioDeviceId(audioDevices[0].deviceId);
      }
      if (videoDevices.length > 0 && !selectedVideoDeviceId) {
        setSelectedVideoDeviceId(videoDevices[0].deviceId);
      }
      
      addDebugLog(`Found ${devices.length} media devices`);
    } catch (error) {
      addDebugLog(`❌ Error enumerating devices: ${error}`);
    }
  };

  // Initialize peer connection
  const createPeerConnection = () => {
    addDebugLog('Creating new peer connection');
    const pc = new RTCPeerConnection(iceServers);

    pc.onicecandidate = (event) => {
      if (event.candidate && callState.callId) {
        addDebugLog(`ICE candidate generated: ${event.candidate.type}`);
        sendMessage({
          type: 'call_ice_candidate',
          callId: callState.callId,
          candidate: event.candidate,
        });
      } else if (!event.candidate) {
        addDebugLog('ICE gathering complete');
      }
    };

    pc.ontrack = (event) => {
      addDebugLog(`Remote track received: ${event.track.kind}`);
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
        addDebugLog('✅ Remote video element set');
        
        // Log track status
        event.track.onended = () => addDebugLog(`Remote ${event.track.kind} track ended`);
        event.track.onmute = () => addDebugLog(`Remote ${event.track.kind} track muted`);
        event.track.onunmute = () => addDebugLog(`Remote ${event.track.kind} track unmuted`);
      }
    };

    pc.onconnectionstatechange = () => {
      addDebugLog(`Connection state: ${pc.connectionState}`);
      if (pc.connectionState === 'connected') {
        addDebugLog('✅ WebRTC Connected!');
        // Start call timer when connection is established
        if (!callTimerRef.current) {
          callTimerRef.current = setInterval(() => {
            setCallDuration(prev => prev + 1);
          }, 1000);
        }
      }
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        addDebugLog('❌ Connection failed/disconnected');
        if (!isCleaningUpRef.current) {
          endCall();
        }
      }
    };

    pc.onicegatheringstatechange = () => {
      addDebugLog(`ICE gathering state: ${pc.iceGatheringState}`);
    };

    pc.oniceconnectionstatechange = () => {
      addDebugLog(`ICE connection state: ${pc.iceConnectionState}`);
      
      if (pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed') {
        addDebugLog('✅ ICE Connection established');
      }
    };

    pc.onsignalingstatechange = () => {
      addDebugLog(`Signaling state: ${pc.signalingState}`);
    };

    return pc;
  };

  // Get user media with device selection
  const getUserMedia = async (type: 'audio' | 'video', options?: {
    audioDeviceId?: string;
    videoDeviceId?: string;
  }) => {
    addDebugLog(`Requesting ${type} access...`);
    try {
      const constraints: MediaStreamConstraints = {
        audio: options?.audioDeviceId 
          ? { deviceId: { exact: options.audioDeviceId } }
          : true,
        video: type === 'video' 
          ? (options?.videoDeviceId 
              ? { deviceId: { exact: options.videoDeviceId } }
              : true)
          : false,
      };
      
      addDebugLog(`Constraints: ${JSON.stringify(constraints)}`);
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      
      addDebugLog(`✅ Got media stream with ${stream.getTracks().length} tracks`);
      stream.getTracks().forEach(track => {
        addDebugLog(`  - ${track.kind} track: ${track.label} (${track.id})`);
      });
      
      localStreamRef.current = stream;
      if (localVideoRef.current && type === 'video') {
        localVideoRef.current.srcObject = stream;
        addDebugLog('✅ Local video element set');
      }
      return stream;
    } catch (error) {
      addDebugLog(`❌ Error accessing media: ${error}`);
      console.error('Error accessing media devices:', error);
      
      // Fallback to simpler constraints if device-specific request fails
      if (error instanceof DOMException && error.name === 'NotFoundError') {
        addDebugLog('Device not found, trying with default device...');
        try {
          const fallbackConstraints: MediaStreamConstraints = {
            audio: true,
            video: type === 'video',
          };
          
          const fallbackStream = await navigator.mediaDevices.getUserMedia(fallbackConstraints);
          addDebugLog('✅ Got fallback media stream');
          localStreamRef.current = fallbackStream;
          if (localVideoRef.current && type === 'video') {
            localVideoRef.current.srcObject = fallbackStream;
          }
          return fallbackStream;
        } catch (fallbackError) {
          addDebugLog(`❌ Fallback also failed: ${fallbackError}`);
        }
      }
      
      alert(`Could not access ${type === 'video' ? 'camera/microphone' : 'microphone'}. Please check permissions.`);
      throw error;
    }
  };

  // Initiate a call
  const initiateCall = async (userId: string, type: 'audio' | 'video') => {
    if (!ws || callState.status !== 'idle') {
      addDebugLog('❌ Cannot initiate call - wrong state or no connection');
      return;
    }

    const user = users.find((u) => u.id === userId);
    if (!user) {
      addDebugLog('❌ User not found');
      return;
    }

    addDebugLog(`📞 Initiating ${type} call to ${user.username}`);

    // CRITICAL: This should update the state IMMEDIATELY
    updateCallState({
      status: 'calling',
      callType: type,
      remoteUserId: userId,
      remoteUsername: user.username,
    });

    // Then send the WebSocket message
    sendMessage({
      type: 'call_initiate',
      to: userId,
      callType: type,
    });
  };

  // Answer incoming call
  const answerCall = async () => {
    console.log('📞 Answer button clicked!');
    console.log('Current callState:', callState);
    console.log('WebSocket readyState:', ws?.readyState);
    
    if (!callState.callId) {
      console.error('❌ Cannot answer - no call ID');
      addDebugLog('❌ Cannot answer - no call ID');
      return;
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('❌ WebSocket not connected');
      addDebugLog('❌ WebSocket not connected');
      return;
    }

    addDebugLog('📞 Answering call...');
    console.log('Sending call_answer message for callId:', callState.callId);

    // First, update the UI immediately
    updateCallState({ status: 'active' });
    
    try {
      // Get media with selected devices
      const stream = await getUserMedia(callState.callType, {
        audioDeviceId: selectedAudioDeviceId,
        videoDeviceId: callState.callType === 'video' ? selectedVideoDeviceId : undefined,
      });
      
      // Create peer connection
      const pc = createPeerConnection();
      peerConnectionRef.current = pc;

      // Add tracks to peer connection
      stream.getTracks().forEach((track) => {
        addDebugLog(`Adding ${track.kind} track to peer connection`);
        pc.addTrack(track, stream);
      });

      // Notify server we're answering
      const success = sendMessage({
        type: 'call_answer',
        callId: callState.callId,
      });

      if (!success) {
        console.error('Failed to send answer message');
        addDebugLog('❌ Failed to send answer message');
      } else {
        console.log('✅ Answer message sent successfully');
        addDebugLog('✅ Answer sent to server');
      }
      
      // Note: We'll receive the offer via WebSocket and handle it in the message handler
    } catch (error) {
      console.error('❌ Error answering call:', error);
      addDebugLog(`❌ Error answering call: ${error}`);
      rejectCall();
    }
  };

  // Reject incoming call
  const rejectCall = () => {
    if (!callState.callId) return;

    addDebugLog('❌ Rejecting call');

    sendMessage({
      type: 'call_reject',
      callId: callState.callId,
    });

    cleanupCall();
  };

  // End active call
  const endCall = () => {
    if (!callState.callId || isCleaningUpRef.current) return;

    addDebugLog('🔴 Ending call');

    sendMessage({
      type: 'call_end',
      callId: callState.callId,
    });

    cleanupCall();
  };

  // Cleanup call resources
  const cleanupCall = () => {
    if (isCleaningUpRef.current) return;
    isCleaningUpRef.current = true;

    addDebugLog('🧹 Cleaning up call resources');

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => {
        track.stop();
        addDebugLog(`Stopped ${track.kind} track`);
      });
      localStreamRef.current = null;
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      addDebugLog('Peer connection closed');
      peerConnectionRef.current = null;
    }

    if (callTimerRef.current) {
      clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }

    // Clear pending ICE candidates
    pendingIceCandidatesRef.current = [];

    // Clear video elements
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }

    resetCallState();
    setIsMuted(false);
    setIsVideoOff(false);
    setCallDuration(0);
    
    isCleaningUpRef.current = false;
    addDebugLog('✅ Cleanup complete');
  };

  // Switch audio input device during call
  const switchAudioDevice = async (deviceId: string) => {
    if (!localStreamRef.current || !peerConnectionRef.current) {
      addDebugLog('❌ Cannot switch device - no active stream or connection');
      return;
    }

    try {
      addDebugLog(`Switching audio device to: ${deviceId}`);
      
      // Get new audio track
      const newStream = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: { exact: deviceId } },
        video: false,
      });
      
      const newAudioTrack = newStream.getAudioTracks()[0];
      if (!newAudioTrack) {
        addDebugLog('❌ No audio track in new stream');
        return;
      }
      
      // Stop old audio tracks
      const oldAudioTracks = localStreamRef.current.getAudioTracks();
      oldAudioTracks.forEach(track => {
        track.stop();
        localStreamRef.current?.removeTrack(track);
      });
      
      // Add new audio track to local stream
      localStreamRef.current.addTrack(newAudioTrack);
      
      // Replace track in peer connection
      const sender = peerConnectionRef.current.getSenders().find(
        s => s.track?.kind === 'audio'
      );
      
      if (sender) {
        await sender.replaceTrack(newAudioTrack);
        addDebugLog('✅ Audio track replaced in peer connection');
      }
      
      // Update mute state to match new track
      setIsMuted(!newAudioTrack.enabled);
      
      // Stop the temporary stream (we only needed the track)
      newStream.getTracks().forEach(track => {
        if (track !== newAudioTrack) track.stop();
      });
      
      addDebugLog(`✅ Switched to audio device: ${newAudioTrack.label}`);
      setSelectedAudioDeviceId(deviceId);
      
    } catch (error) {
      addDebugLog(`❌ Error switching audio device: ${error}`);
      console.error('Error switching audio device:', error);
    }
  };

  // Enhanced toggle mute with better error handling
  const toggleMute = () => {
    if (!localStreamRef.current) {
      addDebugLog('❌ Cannot toggle mute - no local stream');
      return;
    }

    const audioTracks = localStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) {
      addDebugLog('❌ No audio tracks available');
      return;
    }

    // Toggle all audio tracks (usually only one)
    let allMuted = true;
    audioTracks.forEach(track => {
      track.enabled = !track.enabled;
      allMuted = allMuted && !track.enabled;
    });
    
    setIsMuted(allMuted);
    addDebugLog(`🔊 Audio ${allMuted ? 'muted' : 'unmuted'}`);
  };

  // Toggle video
  const toggleVideo = () => {
    if (localStreamRef.current && callState.callType === 'video') {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoOff(!videoTrack.enabled);
        addDebugLog(`📹 Video ${videoTrack.enabled ? 'on' : 'off'}`);
      }
    }
  };

  // Format call duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // WebSocket message handler
  useEffect(() => {
    if (!ws) return;

    const handleMessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        console.log(`📨 Received WebSocket message:`, data);

        switch (data.type) {
          case 'call_initiated':
            console.log('✅ Call initiated confirmed by server');
            updateCallState({
              callId: data.callId,
              status: 'calling' // Keep as calling until answered
            });
            
            // Setup WebRTC connection for caller after getting callId
            if (callState.status === 'calling' && !peerConnectionRef.current) {
              try {
                // Get media with selected devices
                const stream = await getUserMedia(callState.callType, {
                  audioDeviceId: selectedAudioDeviceId,
                  videoDeviceId: callState.callType === 'video' ? selectedVideoDeviceId : undefined,
                });
                
                // Create peer connection
                const pc = createPeerConnection();
                peerConnectionRef.current = pc;

                // Add tracks to peer connection
                stream.getTracks().forEach((track) => {
                  addDebugLog(`Adding ${track.kind} track to peer connection`);
                  pc.addTrack(track, stream);
                });

                // Create offer
                const offer = await pc.createOffer();
                await pc.setLocalDescription(offer);
                
                addDebugLog('✅ Created and set local offer');
                
                // Send offer to remote peer
                sendMessage({
                  type: 'call_offer',
                  callId: data.callId,
                  offer: offer,
                });
              } catch (error) {
                addDebugLog(`❌ Error setting up caller connection: ${error}`);
                console.error('Error setting up caller connection:', error);
                endCall();
              }
            }
            break;

          case 'call_incoming':
            console.log(`📞 Incoming call from ${data.fromUsername}`);
            updateCallState({
              callId: data.callId,
              status: 'incoming',
              callType: data.callType,
              remoteUserId: data.from,
              remoteUsername: data.fromUsername,
            });
            break;

          case 'call_answered':
            console.log('✅ Call answered by recipient');
            // Note: Actual active state will be set when WebRTC connects
            break;

          case 'call_offer':
            console.log('📨 Received call offer');
            if (callState.status === 'active' && peerConnectionRef.current) {
              try {
                // Set remote description
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.offer));
                addDebugLog('✅ Set remote description');
                
                // Create answer
                const answer = await peerConnectionRef.current.createAnswer();
                await peerConnectionRef.current.setLocalDescription(answer);
                
                addDebugLog('✅ Created and set local answer');
                
                // Send answer to remote peer
                sendMessage({
                  type: 'call_answer',
                  callId: callState.callId,
                  answer: answer,
                });
                
                // Process any pending ICE candidates
                if (pendingIceCandidatesRef.current.length > 0) {
                  addDebugLog(`Processing ${pendingIceCandidatesRef.current.length} pending ICE candidates`);
                  for (const candidate of pendingIceCandidatesRef.current) {
                    try {
                      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (e) {
                      addDebugLog(`Error adding pending ICE candidate: ${e}`);
                    }
                  }
                  pendingIceCandidatesRef.current = [];
                }
              } catch (error) {
                addDebugLog(`❌ Error handling offer: ${error}`);
                console.error('Error handling offer:', error);
                endCall();
              }
            }
            break;

          case 'call_answer':
            console.log('📨 Received call answer');
            if (peerConnectionRef.current && callState.status === 'calling') {
              try {
                await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
                addDebugLog('✅ Set remote description from answer');
                
                // Update state to active
                updateCallState({ status: 'active' });
                
                // Process any pending ICE candidates
                if (pendingIceCandidatesRef.current.length > 0) {
                  addDebugLog(`Processing ${pendingIceCandidatesRef.current.length} pending ICE candidates`);
                  for (const candidate of pendingIceCandidatesRef.current) {
                    try {
                      await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(candidate));
                    } catch (e) {
                      addDebugLog(`Error adding pending ICE candidate: ${e}`);
                    }
                  }
                  pendingIceCandidatesRef.current = [];
                }
              } catch (error) {
                addDebugLog(`❌ Error handling answer: ${error}`);
                console.error('Error handling answer:', error);
                endCall();
              }
            }
            break;

          case 'call_ice_candidate':
            console.log('📨 Received ICE candidate');
            if (peerConnectionRef.current) {
              try {
                if (peerConnectionRef.current.remoteDescription) {
                  await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
                  addDebugLog('✅ Added ICE candidate');
                } else {
                  // Remote description not set yet, store candidate for later
                  pendingIceCandidatesRef.current.push(data.candidate);
                  addDebugLog('Stored ICE candidate for later');
                }
              } catch (error) {
                addDebugLog(`❌ Error adding ICE candidate: ${error}`);
                console.error('Error adding ICE candidate:', error);
              }
            }
            break;

          case 'call_ended':
          case 'call_rejected':
            console.log(`❌ Call ${data.type === 'call_ended' ? 'ended' : 'rejected'}`);
            cleanupCall();
            break;

          case 'call_error':
            console.error(`❌ Call error: ${data.error}`);
            alert(`Call error: ${data.error}`);
            cleanupCall();
            break;
        }
      } catch (error) {
        console.error('Error handling WebSocket message:', error);
      }
    };

    ws.addEventListener('message', handleMessage);
    return () => ws.removeEventListener('message', handleMessage);
  }, [ws, callState.callId, callState.status, callState.callType, selectedAudioDeviceId, selectedVideoDeviceId]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupCall();
    };
  }, []);

  // Initialize device enumeration on mount
  useEffect(() => {
    enumerateDevices();
    
    // Listen for device changes
    navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);
    
    return () => {
      navigator.mediaDevices.removeEventListener('devicechange', enumerateDevices);
    };
  }, []);

  // Don't render anything if no active call
  if (callState.status === 'idle') {
    return (
      <div className="call-users-container">
        {/* Device Selection (optional) */}
        {availableDevices.length > 0 && (
          <div className="device-selection">
            <h3>Audio Input:</h3>
            <select 
              value={selectedAudioDeviceId}
              onChange={(e) => setSelectedAudioDeviceId(e.target.value)}
            >
              {availableDevices
                .filter(d => d.kind === 'audioinput')
                .map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
            </select>
            
            <h3>Video Input:</h3>
            <select 
              value={selectedVideoDeviceId}
              onChange={(e) => setSelectedVideoDeviceId(e.target.value)}
            >
              {availableDevices
                .filter(d => d.kind === 'videoinput')
                .map(device => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
            </select>
            
            <button 
              onClick={enumerateDevices}
              className="refresh-devices-btn"
            >
              🔄 Refresh Devices
            </button>
          </div>
        )}

        <div className="call-buttons">
          {users
            .filter((user) => user.id !== currentUserId && user.online)
            .map((user) => (
              <div key={user.id} className="user-call-controls">
                <span className="user-name">{user.username}</span>
                <button
                  className="call-btn video-call"
                  onClick={() => initiateCall(user.id, 'video')}
                  title="Video call"
                  disabled={callState.status !== 'idle'}
                >
                  📹
                </button>
                <button
                  className="call-btn audio-call"
                  onClick={() => initiateCall(user.id, 'audio')}
                  title="Audio call"
                  disabled={callState.status !== 'idle'}
                >
                  📞
                </button>
              </div>
            ))}
        </div>
      </div>
    );
  }

  return (
    <div className="call-popup">
      <div className="call-overlay" onClick={endCall} />
      <div className="call-container">
        {/* Incoming Call */}
        {callState.status === 'incoming' && (
          <div className="incoming-call">
            <div className="caller-info">
              <div className="avatar">{callState.remoteUsername?.[0] || '?'}</div>
              <h2>{callState.remoteUsername}</h2>
              <p>Incoming {callState.callType} call...</p>
              {/* Add debug info */}
              <p style={{ fontSize: '12px', color: '#666' }}>
                Call ID: {callState.callId}
              </p>
            </div>
            <div className="call-actions">
              <button 
                className="btn-answer" 
                onClick={answerCall}
                style={{ background: 'green', color: 'white' }}
              >
                📞 Answer
              </button>
              <button className="btn-reject" onClick={rejectCall}>
                ❌ Decline
              </button>
            </div>
          </div>
        )}

        {/* Calling / Ringing */}
        {callState.status === 'calling' && (
          <div className="calling-state">
            <div className="caller-info">
              <div className="avatar">{callState.remoteUsername?.[0] || '?'}</div>
              <h2>{callState.remoteUsername}</h2>
              <p>Calling...</p>
            </div>
            <button className="btn-end-call" onClick={endCall}>
              ❌ Cancel
            </button>
          </div>
        )}

        {/* Active Call */}
        {callState.status === 'active' && (
          <div className="active-call">
            <div className="call-header">
              <span className="remote-user">{callState.remoteUsername}</span>
              <span className="call-duration">{formatDuration(callDuration)}</span>
            </div>

            <div className="video-container">
              <video
                ref={remoteVideoRef}
                autoPlay
                playsInline
                className="remote-video"
              />
              {callState.callType === 'video' && (
                <video
                  ref={localVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="local-video"
                />
              )}
            </div>

            <div className="call-controls">
              <button
                className={`control-btn ${isMuted ? 'active' : ''}`}
                onClick={toggleMute}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? '🔇' : '🔊'}
              </button>

              {callState.callType === 'video' && (
                <button
                  className={`control-btn ${isVideoOff ? 'active' : ''}`}
                  onClick={toggleVideo}
                  title={isVideoOff ? 'Turn on camera' : 'Turn off camera'}
                >
                  {isVideoOff ? '📷' : '📹'}
                </button>
              )}

              <button 
                className="control-btn end-call" 
                onClick={endCall}
                title="End call"
              >
                📞
              </button>
            </div>

            {/* Device Selection during call (optional) */}
            {availableDevices.filter(d => d.kind === 'audioinput').length > 1 && (
              <div className="device-switcher">
                <select 
                  value={selectedAudioDeviceId}
                  onChange={(e) => switchAudioDevice(e.target.value)}
                  className="device-select"
                >
                  {availableDevices
                    .filter(d => d.kind === 'audioinput')
                    .map(device => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {device.label}
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Debug Panel - Remove in production */}
            <div style={{
              position: 'absolute',
              bottom: '80px',
              left: '10px',
              right: '10px',
              maxHeight: '150px',
              overflowY: 'auto',
              background: 'rgba(0,0,0,0.8)',
              color: '#0f0',
              padding: '10px',
              fontSize: '11px',
              fontFamily: 'monospace',
              borderRadius: '5px',
            }}>
              <div style={{ marginBottom: '5px', fontWeight: 'bold' }}>Debug Log:</div>
              {debugLog.map((log, i) => (
                <div key={i}>{log}</div>
              ))}
            </div>
          </div>
        )}

        {/* Reconnecting State */}
        {callState.status === 'reconnecting' && (
          <div className="reconnecting-state">
            <div className="reconnecting-info">
              <div className="spinner"></div>
              <h2>Reconnecting...</h2>
              <p>Your connection was interrupted. Attempting to restore the call...</p>
              {callState.isPeerDisconnected && (
                <div className="peer-disconnected">
                  <p>⚠️ The other person temporarily lost connection.</p>
                  <p>The call will resume when they reconnect.</p>
                </div>
              )}
              {callState.reconnectAttempts && callState.reconnectAttempts > 0 && (
                <p className="reconnect-attempts">Attempt {callState.reconnectAttempts}...</p>
              )}
              <div className="reconnection-timer">
                <p>Grace period remaining: 30 seconds</p>
                <div className="progress-bar">
                  <div className="progress-fill"></div>
                </div>
              </div>
              <button className="btn-end-call" onClick={endCall}>
                ❌ End Call Now
              </button>
            </div>
          </div>
        )}

        {/* Ending State */}
        {callState.status === 'ending' && (
          <div className="ending-state">
            <div className="ending-info">
              <div className="spinner"></div>
              <h2>Ending Call...</h2>
              <p>Please wait while we clean up the connection...</p>
              <p className="hint">This may take a few seconds</p>
            </div>
          </div>
        )}

        {/* Error/Unknown State */}
        {!['idle', 'incoming', 'calling', 'active', 'reconnecting', 'ending'].includes(callState.status) && (
          <div className="error-state">
            <div className="error-info">
              <h2>⚠️ Unknown Call State</h2>
              <p>Current state: {callState.status}</p>
              <p>Something went wrong with the call.</p>
              <button className="btn-end-call" onClick={cleanupCall}>
                ❌ Reset Call
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CallUsers;