"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import mediasoupClient from 'mediasoup-client'

const VideoCallUI = () => {
    const [selfSocketId, setSelfSocketId] = useState(null);
    const [audio, setAudio] = useState(true);
    const [video, setVideo] = useState(true);
    const [stream, setStream] = useState(null);
    const [remoteStream, setRemoteStream] = useState(null);
    const [sockt, setSockt] = useState(null);
    const [rtpCapabilities, setRtpCapabilities] = useState(null);
    const [device, setDevice] = useState();
    const [producerTransport, setProducerTransport] = useState();
    const [consumerTransport, setConsumerTransport] = useState();
    const [producer, setProducer] = useState();
    const [consumer, setConsumer] = useState();
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
    const handleConnSuccess = useCallback((socketId) => {
        console.log("✅ Socket connected to frontend:", socketId);
        setSelfSocketId(socketId);
    }, []);

    useEffect(() => {
        const socket = io("https://localhost:5000", {
            transports: ["websocket"],
            secure: true,
            rejectUnauthorized: false,
        });

        setSockt(socket);
        socket.on("connection-success", handleConnSuccess);

        return () => {
            socket.off("connection-success", handleConnSuccess);
            socket.disconnect();
        };
    }, [handleConnSuccess]);

    const getLocalStream = useCallback(async () => {
        try {
            const newStream = await navigator.mediaDevices.getUserMedia({
                audio: audio,
                video: video,
            });

            setStream(newStream);
            streamSuccess(newStream);
        } catch (error) {
            console.error("❌ Error accessing media devices:", error.message);
        }
    }, [audio, video]);

    const streamSuccess = (newStream) => {
        if (localVideoRef.current) {
            localVideoRef.current.srcObject = newStream;
        } else {
            console.error("❌ localVideo element not found!");
        }

        console.log("✅ Stream updated:", { audio, video });
    };

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

    const createDevice = useCallback(async () => {
        try {
            const newDevice = new mediasoupClient.Device();
            setDevice(newDevice);

            // https://mediasoup.org/documentation/v3/mediasoup-client/api/#device-load
            // Loads the device with RTP capabilities of the Router (server side)
            await newDevice.load({
                routerRtpCapabilities: rtpCapabilities
            });

            console.log('RTP Capabilities', newDevice.rtpCapabilities);
        } catch (error) {
            console.log(error);
            if (error.name === 'UnsupportedError')
                console.warn('browser not supported');
        }
    }, [rtpCapabilities]);

    // ✅ Request RTP Capabilities from the backend
    const getRTPCapabilities = useCallback(() => {
        if (sockt) {
            sockt.emit("getRTPCapabilities", (data) => {
                console.log("✅ RTP Capabilities received from backend:", data);
                setRtpCapabilities(data.rtpCapabilities);
            });
        } else {
            console.error("❌ Socket not initialized");
        }
    }, [sockt]);

    const createSendTransport = useCallback(() => {
        if (!sockt || !device) {
            console.error("❌ Socket or Device not initialized");
            return;
        }

        console.log("🟢 Requesting WebRTC Transport...");

        sockt.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
            if (!params || params.error) {
                console.error("❌ Error receiving transport parameters:", params?.error);
                return;
            }

            console.log("✅ Received Transport Params:", params);

            try {
                const newTransport = device.createSendTransport(params);
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

                newTransport.on("connectionstatechange", (state) => {
                    console.log("🔄 Transport State Changed:", state);
                    if (state === "failed" || state === "closed") {
                        console.error("❌ Transport Connection Failed");
                        newTransport.close();
                    }
                });
            } catch (error) {
                console.error("❌ Error creating send transport:", error);
            }
        });
    }, [sockt, device]);

    const connectSendTransport = useCallback(async () => {
        if (!producerTransport || !stream) {
            console.error("❌ Producer transport or media stream not available");
            return;
        }

        console.log("📡 Starting Media Production...");

        const track = stream.getVideoTracks()[0];
        if (!track) {
            console.error("❌ No video track available");
            return;
        }

        try {
            let tempProducer = await producerTransport.produce({ track });

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

    const createRecvTransport = useCallback(async () => {
        await sockt.emit('createWebRtcTransport', { sender: false }, ({ params }) => {
            if (params.error) {
                console.log(params.error);
                return;
            }
            console.log(params);
            let tempConsumerTransport = device.createRecvTransport(params);
            tempConsumerTransport.on('connect', async ({ dtlsParameters }, callback, errback) => {
                try {
                    await sockt.emit('transport-recv-connect', {
                        dtlsParameters,
                    });
                    // Tell the transport that parameters were transmitted.
                    callback();
                } catch (error) {
                    // Tell the transport that something was wrong
                    errback(error);
                }
            });
            setConsumerTransport(tempConsumerTransport);
        });
    }, [sockt, params, device]);

    const connectRecvTransport = useCallback(async () => {
        try {
            await sockt.emit('consume', {
                rtpCapabilities: device.rtpCapabilities,
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
                        Start Video
                    </button>

                    {/* End Call */}
                    <button className="bg-red-700 hover:bg-red-800 text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg">
                        End Call
                    </button>
                </div>

                {/* Advanced Controls */}
                <div className="grid grid-cols-3 gap-3 mt-6 text-center">
                    <button className="bg-purple-500 hover:bg-purple-600 text-white py-2 px-4 rounded-md shadow-md"
                        onClick={getRTPCapabilities}>
                        Get RTP Capabilities
                    </button>
                    <button className="bg-teal-500 hover:bg-teal-600 text-white py-2 px-4 rounded-md shadow-md"
                        onClick={createDevice}>
                        Create Device
                    </button>
                    <button className="bg-red-500 hover:bg-red-600 text-white py-2 px-4 rounded-md shadow-md"
                        onClick={createSendTransport}>
                        Create Send Transport
                    </button>
                </div>

                <div className="grid grid-cols-3 gap-3 mt-4 text-center">
                    <button className="bg-yellow-500 hover:bg-yellow-600 text-black py-2 px-4 rounded-md shadow-md"
                        onClick={connectSendTransport}>
                        Connect Send & Produce
                    </button>
                    <button className="bg-indigo-500 hover:bg-indigo-600 text-white py-2 px-4 rounded-md shadow-md"
                        onClick={createRecvTransport}>
                        Create Recv Transport
                    </button>
                    <button className="bg-green-500 hover:bg-green-600 text-white py-2 px-4 rounded-md shadow-md"
                        onClick={connectRecvTransport}>
                        Connect Recv & Consume
                    </button>
                </div>

                {/* Send Message */}
                <div className="mt-4 text-center">
                    <button className="bg-orange-500 hover:bg-orange-600 text-white py-2 px-6 rounded-md text-lg font-semibold shadow-md">
                        Send Message
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
