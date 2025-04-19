"use client";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { io } from "socket.io-client";
import mediasoupClient from "mediasoup-client";

const VideoCallUI = () => {
  const [selfSocketId, setSelfSocketId] = useState(null);
  const [audio, setAudio] = useState(true);
  const [video, setVideo] = useState(true);
  const [stream, setStream] = useState(null);
  const newLocalStream = useRef(null);
  const [remoteStream, setRemoteStream] = useState(null);
  const [sockt, setSockt] = useState(null);
  const [rtpCapabilities, setRtpCapabilities] = useState(null);
  const [device, setDevice] = useState(null);
  const [producerTransport, setProducerTransport] = useState();
  const [consumerTransport, setConsumerTransport] = useState();
  const [producer, setProducer] = useState();
  const [consumer, setConsumer] = useState();
  const [isProducer, setIsProducer] = useState(false);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState(null);

  const [params, setParams] = useState({
    encodings: [
      {
        rid: "r0",
        maxBitrate: 100000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r1",
        maxBitrate: 300000,
        scalabilityMode: "S1T3",
      },
      {
        rid: "r2",
        maxBitrate: 900000,
        scalabilityMode: "S1T3",
      },
    ],
    codecOptions: {
      videoGoogleStartBitrate: 1000,
    },
  });

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const handleConnSuccess = useCallback(({ socketId, existsProducer }) => {
    console.log("1 ✅ Socket connected to frontend:", socketId);
    console.log("2 Value of existsProducer in frontend:", existsProducer);
    setSelfSocketId(socketId);
    setIsProducer(!existsProducer);
  }, []);

  const goCreateTransport = (prodOrCons) => {
    console.log("goCreateTransport called. isProducer:", isProducer);
    prodOrCons ? createSendTransport(device) : createRecvTransport(device);
  };

  const goConnect = useCallback(
    (prodOrCons) => {
      if (sockt) {
        if (!device) {
          getRTPCapabilities(prodOrCons);
        } else {
          goCreateTransport(prodOrCons);
        }
      } else {
        console.error("❌ Socket not initialized yet in goConnect.");
      }
    },
    [device, sockt]
  );

  const getLocalStream = useCallback(async () => {
    try {
      const constraints = {
        audio,
        video: selectedCameraId
          ? { deviceId: { exact: selectedCameraId } }
          : true,
      };

      const newStream = await navigator.mediaDevices.getUserMedia(constraints);
      setStream(newStream);
      newLocalStream.current = newStream;
      streamSuccess(newStream);
    } catch (error) {
      console.error("❌ Error accessing media devices:", error.message);
    }
  }, [audio, video, selectedCameraId, sockt]);

  const streamSuccess = useCallback(
    (newStream) => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = newStream;

        const track = newStream.getVideoTracks()[0];
        if (sockt) {
          setParams({ track, ...params });
          goConnect(true);
        } else {
          setTimeout(() => {
            if (sockt) goConnect(true);
            else console.error("❌ Still no socket, retrying failed.");
          }, 500);
        }
      } else {
        console.error("❌ localVideo element not found!");
      }
    },
    [sockt, params]
  );

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

  const connectSendTransport = useCallback(
    async (newTransport) => {
      const tempStream = newLocalStream.current;
      if (!newTransport || !tempStream) return;

      const track = tempStream.getVideoTracks()[0];
      if (!track) return;

      try {
        let tempProducer = await newTransport.produce({ track });

        tempProducer.on("trackended", () => {
          console.warn("⚠️ Track ended.");
        });

        tempProducer.on("transportclose", () => {
          tempProducer.close();
        });

        setProducer(tempProducer);
      } catch (error) {
        console.error("❌ Error starting media production:", error);
      }
    },
    [producerTransport, stream]
  );

  const connectRecvTransport = useCallback(
    async (newDevice, tempConsumerTransport) => {
      try {
        await sockt.emit(
          "consume",
          {
            rtpCapabilities: newDevice.rtpCapabilities,
          },
          async ({ params }) => {
            if (params.error) {
              return;
            }

            let tempConsumer = await tempConsumerTransport.consume({
              id: params.id,
              producerId: params.producerId,
              kind: params.kind,
              rtpParameters: params.rtpParameters,
            });
            setConsumer(tempConsumer);

            const { track } = tempConsumer;

            if (remoteVideoRef.current && track) {
              let tempRemoteStream = new MediaStream([track]);
              remoteVideoRef.current.srcObject = tempRemoteStream;
            }

            sockt.emit("consumer-resume");
          }
        );
      } catch (error) {
        console.error("❌ Error connecting to recv transport:", error);
      }
    },
    [sockt]
  );

  const createSendTransport = useCallback(
    (newDevice) => {
      sockt.emit("createWebRtcTransport", { sender: true }, ({ params }) => {
        if (!params || params.error) return;

        let newTransport = newDevice.createSendTransport(params);
        setProducerTransport(newTransport);

        newTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            await sockt.emit("transport-connect", { dtlsParameters });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        newTransport.on("produce", async (parameters, callback, errback) => {
          try {
            sockt.emit(
              "transport-produce",
              {
                kind: parameters.kind,
                rtpParameters: parameters.rtpParameters,
                appData: parameters.appData,
              },
              ({ id }) => {
                callback({ id });
              }
            );
          } catch (error) {
            errback(error);
          }
        });

        connectSendTransport(newTransport);
      });
    },
    [sockt, device, connectSendTransport]
  );

  const createRecvTransport = useCallback(
    async (newDevice) => {
      if (sockt) {
        const tempParams = await new Promise((resolve, reject) => {
          sockt.emit("createWebRtcTransport", { sender: false }, ({ params }) => {
            if (!params || !params.id || params.error) return reject("Transport creation failed");
            resolve(params);
          });
        });

        const tempConsumerTransport = newDevice.createRecvTransport(tempParams);

        tempConsumerTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            await sockt.emit("transport-recv-connect", { dtlsParameters });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        setConsumerTransport(tempConsumerTransport);
        connectRecvTransport(newDevice, tempConsumerTransport);
      }
    },
    [sockt, connectRecvTransport]
  );

  const createDevice = async (rtpCaps, prodOrCons) => {
    if (!rtpCaps) return;
    try {
      const newDevice = new mediasoupClient.Device();
      await newDevice.load({ routerRtpCapabilities: rtpCaps });

      if (prodOrCons) {
        createSendTransport(newDevice);
        setDevice(newDevice);
      } else {
        createRecvTransport(newDevice);
      }
    } catch (error) {
      if (error.name === "UnsupportedError") {
        console.warn("Browser does not support Mediasoup");
      }
    }
  };

  const getRTPCapabilities = useCallback(
    (prodOrCons) => {
      sockt.emit("createRoom", (data) => {
        if (data?.rtpCapabilities) {
          setRtpCapabilities(() => {
            createDevice(data.rtpCapabilities, prodOrCons);
            return data.rtpCapabilities;
          });
        }
      });
    },
    [sockt]
  );

  const goConsume = () => {
    goConnect(false);
  };

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

  // Fetch available video devices
  useEffect(() => {
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      const videoInputs = devices.filter((device) => device.kind === "videoinput");
      setVideoDevices(videoInputs);
      if (videoInputs.length > 0) setSelectedCameraId(videoInputs[0].deviceId);
    });
  }, []);

  return (
    <div className="flex items-center justify-center h-screen bg-gray-900">
      <div className="bg-gray-800 bg-opacity-90 p-6 rounded-lg shadow-xl w-[900px]">
        <h2 className="text-white text-center text-xl font-semibold mb-4">Live Video Call</h2>

        <div className="grid grid-cols-2 gap-6">
          <div className="relative border-4 border-gray-700 rounded-lg overflow-hidden">
            <video ref={localVideoRef} autoPlay playsInline className="w-full h-[250px] bg-gray-600"></video>
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-md text-sm">
              You
            </div>
          </div>

          <div className="relative border-4 border-gray-700 rounded-lg overflow-hidden">
            <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-[250px] bg-gray-600"></video>
            <div className="absolute bottom-2 left-2 bg-black bg-opacity-50 text-white px-3 py-1 rounded-md text-sm">
              Other
            </div>
          </div>
        </div>

        {/* Camera Selector */}
        <div className="mt-4">
          <label className="text-white block mb-1">Select Camera:</label>
          <select
            value={selectedCameraId || ""}
            onChange={(e) => setSelectedCameraId(e.target.value)}
            className="w-full px-3 py-2 rounded-md bg-gray-700 text-white"
          >
            {videoDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label || `Camera ${device.deviceId}`}
              </option>
            ))}
          </select>
        </div>

        <div className="flex justify-center gap-4 mt-6">
          <button
            onClick={handleAudio}
            className={`text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg transition ${
              !audio ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"
            }`}
          >
            {audio ? "Mic Off" : "Mic On"}
          </button>

          <button
            onClick={handleVideo}
            className={`text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg transition ${
              !video ? "bg-green-500 hover:bg-green-600" : "bg-red-500 hover:bg-red-600"
            }`}
          >
            {!video ? "Video On" : "Video Off"}
          </button>

          <button
            onClick={getLocalStream}
            className="bg-blue-500 hover:bg-blue-600 text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg"
          >
            Start Call
          </button>

          <button className="bg-red-700 hover:bg-red-800 text-white px-6 py-3 rounded-full text-lg font-semibold shadow-lg">
            End Call
          </button>
        </div>

        <div className="grid grid-cols-3 gap-3 mt-6 text-center">
          <button
            className="bg-indigo-500 hover:bg-indigo-600 text-white py-2 px-4 rounded-md shadow-md"
            onClick={goConsume}
          >
            Accept Call
          </button>
        </div>

        <div className="text-white text-center mt-6 text-sm">
          {selfSocketId && (
            <p>
              🔗 MediaSoup Socket ID: <span className="font-semibold">{selfSocketId}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
};

export default VideoCallUI;
