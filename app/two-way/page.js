"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import mediasoupClient from 'mediasoup-client'

const VideoCallUI = () => {
    const [selfSocketId, setSelfSocketId] = useState(null);
    const [audio, setAudio] = useState(false);
    const [video, setVideo] = useState(true);
    const [stream, setStream] = useState(null);
    const newLocalStream = useRef(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [sockt, setSockt] = useState(null);
    const [rtpCapabilities, setRtpCapabilities] = useState(null);
    const [device, setDevice] = useState();
    const [producerTransport, setProducerTransport] = useState();
    const [consumerTransport, setConsumerTransport] = useState();
    const [producer, setProducer] = useState();
    const [consumer, setConsumer] = useState();
    const [isProducer, setIsProducer] = useState(false);
    const [params, setParams] = useState({
        encodings: [
            {
                rid: 'r0',
                maxBitrate: 100000,
                scalabilityMode: 'S1T3',
            },
            {
                rid: 'r1',
                maxBitrate: 300000,
                scalabilityMode: 'S1T3',
            },
            {
                rid: 'r2',
                maxBitrate: 900000,
                scalabilityMode: 'S1T3',
            },
        ],
        codecOptions: {
            videoGoogleStartBitrate: 1000,
        }
    });
    
    // Refs for the video elements
    const localVideoRef = useRef(null);
    const remoteVideoRef = useRef(null);
    
    // Handle successful connection
    const handleConnSuccess = useCallback(({ socketId, existsProducer }) => {
        console.log("✅ Socket connected to frontend:", socketId);
        console.log('is producer in frontend:', existsProducer);
        setSelfSocketId(socketId);
        setIsProducer(existsProducer); // Set whether the user is a producer or not
    }, [setSelfSocketId, setIsProducer]);
    const goCreateTransport=()=>{
        isProducer?createSendTransport():createRecvTransport();
    }
    const goConnect = useCallback((prodOrCons) => {
        // setIsProducer(prev=>prodOrCons);
        // Call getRTPCapabilities only if sockt is initialized and connected
       console.log('value of device in go connect is ',device);
        if (sockt) {
            if (!device) {
                getRTPCapabilities(prodOrCons);
            } else {
                goCreateTransport(prodOrCons);
            }
        } else {
            console.error("❌ Socket not initialized yet in go connect .");
        }
    },[device,sockt]); // `sockt` added to dependencies
    
    
    const getLocalStream = useCallback(async () => {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: audio,
                video: video,
            });
            console.log('value of socket in get local stream is ',sockt);
            setStream(newStream);
            newLocalStream.current=newStream;
            streamSuccess(newStream);
        } catch (error) {
            console.error("❌ Error accessing media devices:", error.message);
        }
    }, [audio, video,sockt]);
    
    const streamSuccess = useCallback((newStream) => {
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = newStream;
            // Ensure socket is initialized before proceeding
            const track = newStream.getVideoTracks()[0]
            if (sockt) {
                setParams({track,...params});
                
                goConnect(true);
                
            } else {
                console.error("❌ Socket is not yet initialized, waiting...");
                setTimeout(() => {
                    if (sockt) goConnect(true);
                    else console.error("❌ Still no socket, retrying failed.");
                }, 500); // Small delay to allow socket initialization
            }
        } else {
            console.error("❌ localVideo element not found!");
        }
    },[sockt,params]);
    const handleAudio = () => {
        if (stream) {
            const audioTrack = stream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                setAudio(audioTrack.enabled);
            }
        }
    };
    
    const handleVideo = () => {
        if (stream) {
            const videoTrack = stream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                setVideo(videoTrack.enabled);
            }
        }
    };
    
    const connectSendTransport = useCallback(async (newTransport) => {
        // console.log('producer transport ',producerTransport);
        const tempStream=newLocalStream.current;
        console.log('media stream ',tempStream);
        
        if (!newTransport || !tempStream) {
            console.error("❌ Producer transport or media stream not available");
            return;
        }
        console.log("📡 Starting Media Production...");
    
        const track = tempStream.getVideoTracks()[0];
        if (!track) {
            console.error("❌ No video track available");
            return;
        }
    
        try {
            let tempProducer = await newTransport.produce({ track });
    
            tempProducer.on("trackended", () => {
                console.warn("⚠️ Track ended.");
            });
    
            tempProducer.on("transportclose", () => {
                console.warn("⚠️ Transport closed.");
                tempProducer.close();
            });
    
            console.log("✅ Media production started.");
            setProducer(tempProducer);
        } catch (error) {
            console.error("❌ Error starting media production:", error);
        }
    }, [producerTransport, stream]);
    
    const connectRecvTransport = useCallback(async (newDevice) => {
        try {
            await sockt.emit('consume', {
                rtpCapabilities: newDevice.rtpCapabilities,
            }, async ({ params }) => {
                if (params.error) {
                    console.log('Cannot Consume');
                    console.log(params.error);
                    return;
                }
                console.log(params);
                let tempConsumer = await consumerTransport.consume({
                    id: params.id,
                    producerId: params.producerId,
                    kind: params.kind,
                    rtpParameters: params.rtpParameters
                });
                setConsumer(tempConsumer);
    
                const { track } = tempConsumer;
    
                if (remoteVideoRef.current && track) {
                    let tempRemoteStream = new MediaStream([track]);
                    remoteVideoRef.current.srcObject = tempRemoteStream;
                    console.log("✅ Remote video stream set successfully");
                } else {
                    console.error("❌ No track available or remoteVideoRef is null");
                }
    
                sockt.emit('consumer-resume');
            });
        } catch (error) {
            console.error("❌ Error connecting to recv transport:", error);
        }
    }, [setConsumer, params, sockt, device, consumerTransport]);
    
    const createSendTransport = useCallback((newDevice) => {
        console.log('in create send device is ',newDevice);
        if (!sockt || !newDevice) {
            console.error("❌ Socket or Device not initialized in send transport ");
            return;
        }
    
        console.log("🟢 Requesting WebRTC Transport...");
    
        sockt.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
            if (!params || params.error) {
                console.error("❌ Error receiving transport parameters:", params?.error);
                return;
            }
    
            console.log("✅ Received Transport Params:", params);
            let newTransport;
            try {
                newTransport = newDevice.createSendTransport(params);
                setProducerTransport(newTransport);
                newTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
                    console.log("🔗 Connecting transport...");
                    try {
                        await sockt.emit("transport-connect", { dtlsParameters });
                        callback();
                    } catch (error) {
                        console.error("❌ Transport connection failed:", error);
                        errback(error);
                    }
                });
    
                newTransport.on("produce", async (parameters, callback, errback) => {
                    console.log("📡 Producing stream...", parameters);
                    try {
                        sockt.emit(
                            "transport-produce",
                            {
                                kind: parameters.kind,
                                rtpParameters: parameters.rtpParameters,
                                appData: parameters.appData,
                            },
                            ({ id }) => {
                                console.log("✅ Producer ID received:", id);
                                callback({ id });
                            }
                        );
                    } catch (error) {
                        console.error("❌ Producer error:", error);
                        errback(error);
                    }
                });
    
                // newTransport.on("connectionstatechange", (state) => {
                //     console.log("🔄 Transport State Changed:", state);
                //     if (state === "failed" || state === "closed") {
                //         console.error("❌ Transport Connection Failed");
                //         newTransport.close();
                //     }
                // });
                connectSendTransport(newTransport)
            } catch (error) {
                console.error("❌ Error creating send transport:", error);
            }
        });
    }, [sockt, device, connectSendTransport]);
    
    const createRecvTransport = useCallback(async () => {
        if (!device) {
            console.error("❌ Device is not initialized yet!");
            return; // Exit the function if device is not set
        }
    
        if (sockt) {
            await sockt.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
                if (params.error) {
                    console.log(params.error);
                    return;
                }
                console.log(params);
                let tempConsumerTransport = device.createRecvTransport(params);
                tempConsumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                    try {
                        await sockt.emit('transport-recv-connect', { dtlsParameters });
                        callback(); // Transport connect success
                    } catch (error) {
                        errback(error); // Handle error in connection
                    }
                });
                setConsumerTransport(tempConsumerTransport);
                connectRecvTransport(); // Start consuming
            });
        }
    }, [sockt, device, connectRecvTransport]);
    
    const createDevice = async (rtpCaps,prodOrCons) => {
        console.log('Entered createDevice');
        if (!rtpCaps) {
            console.error("❌ RTP Capabilities not available yet.");
            return;
        }
        try {
            const newDevice = new mediasoupClient.Device();
            
            console.log('Device created:', newDevice);
    
            // Load the device with RTP capabilities from the backend (router)
            await newDevice.load({
                routerRtpCapabilities: rtpCaps,  // Use passed parameter instead of state
            });
            setDevice(newDevice);
            console.log('✅ Device loaded with RTP Capabilities:', newDevice.rtpCapabilities);
            console.log('value of isProducer in create device is ',isProducer);
            // Based on whether the user is a producer or consumer, create appropriate transport
            if (prodOrCons) {
                createSendTransport(newDevice);
            } else {
                createRecvTransport();
            }
        } catch (error) {
            console.error("❌ Error creating device:", error);
            if (error.name === 'UnsupportedError') {
                console.warn('❌ Browser does not support Mediasoup');
            }
        }
    };
    
    
    // ✅ Request RTP Capabilities from the backend
    const getRTPCapabilities = useCallback((prodOrCons) => {
        sockt.emit("createRoom", (data) => {
            if (data && data.rtpCapabilities) {
                console.log("✅ RTP Capabilities received from backend:", data);
    
                // Use functional update to ensure we have the latest value
                setRtpCapabilities((prev) => {
                    const updatedRtpCapabilities = data.rtpCapabilities;
    
                    // Call createDevice immediately with the new value
                    createDevice(updatedRtpCapabilities,prodOrCons);
                    
                    return updatedRtpCapabilities;
                });
            } else {
                console.error("❌ RTP Capabilities not available from backend.");
            }
        });        
    }, [sockt]);
    useEffect(() => {
        const socket = io("https://localhost:5000", {
            transports: ["websocket"],
            secure: true,
            rejectUnauthorized: false,
        });
    
        setSockt(socket);
    
        socket.on("connection-success", handleConnSuccess);
    
        // Proceed only if socket is connected and rtpCapabilities are received
        // socket.on("rtpCapabilities", (data) => {
        //     if (data && data.rtpCapabilities) {
        //         setRtpCapabilities(data.rtpCapabilities);
        //         console.log("✅ RTP Capabilities received from backend:", data.rtpCapabilities);
        //     }
        // });
    
        return () => {
            socket.off("connection-success", handleConnSuccess);
            // socket.off("rtpCapabilities");
            socket.disconnect();
        };
    }, [handleConnSuccess,setSockt]);
    return (
        <div className="flex items-center justify-center h-screen bg-gray-900">
            <div className="bg-gray-800 bg-opacity-90 p-6 rounded-lg shadow-xl w-[900px]">
                {/* Title */}
                <h2 className="text-white text-center text-xl font-semibold mb-4">Live Video Call</h2>

                {/* Video Section */}
                <div className="grid grid-cols-2 gap-6">
                    {/* Local Video */}
                    <div className="relative border-4 border-gray-700 rounded-lg overflow-hidden">
                        <video ref={localVideoRef} autoPlay playsInline className="w-full h-[250px] bg-gray-600"></video>
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-md text-sm">
                            You
                        </div>
                    </div>

                    {/* Remote Video */}
                    <div className="relative border-4 border-gray-700 rounded-lg overflow-hidden">
                        <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-[250px] bg-gray-600"></video>
                        <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-md text-sm">
                            Other
                        </div>
                    </div>
                </div>

                {/* Controls Section */}
                <div className="flex justify-center gap-4 mt-6">
                    {/* Mic Toggle */}
                    <button
                        onClick={handleAudio}
                        className={`text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg transition ${!audio ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"
                            }`}
                    >
                        {audio ? "Mic Off" : "Mic On"}
                    </button>

                    {/* Video Toggle */}
                    <button
                        onClick={handleVideo}
                        className={`text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg transition ${!video ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"
                            }`}
                    >
                        {!video ? "Video On" : "Video Off"}
                    </button>

                    {/* Get Local Video */}
                    <button
                        onClick={getLocalStream}
                        className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg"
                    >
                        Start Call
                    </button>

                    {/* End Call */}
                    <button className="bg-red-700 hover:bg-red-800 text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg">
                        End Call
                    </button>
                </div>
                {/* Advanced Controls */}
                <div className="grid grid-cols-3 gap-3 mt-6 text-center">
                <button className="bg-indigo-500 hover:bg-indigo-600 text-white py-2 px-4 rounded-md shadow-md"
                        onClick={createRecvTransport}>
                        Accept Call
                    </button>
                    
                </div>

           

                

                {/* Socket ID Display */}
                <div className="text-white text-center mt-6 text-sm">
                    {selfSocketId && <p>🔗 MediaSoup Socket ID: <span className="font-semibold">{selfSocketId}</span></p>}
                </div>
            </div>
        </div>
    );
};
export default VideoCallUI;
