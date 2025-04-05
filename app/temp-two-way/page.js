"use client"
import { useEffect, useRef, useState } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";
// import { Button } from "@/components/ui/button";

const socket = io("localhost:5000");




export default function MediasoupClient() {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [device, setDevice] = useState(null);
  const [producerTransport, setProducerTransport] = useState(null);
  const [consumerTransport, setConsumerTransport] = useState(null);
  const [producer, setProducer] = useState(null);
  const [consumer, setConsumer] = useState(null);
  const [rtpCapabilities, setRtpCapabilities] = useState(null);

  useEffect(() => {
    socket.on("connection-success", ({ socketId }) => {
      console.log("Connected with socket ID:", socketId);
    });
  }, []);

  const getLocalStream = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      goConnect(true, stream);
    } catch (error) {
      console.error("Error getting user media:", error);
    }
  };

  const goConnect = (isProducer, stream) => {
    if (!device) {
      getRtpCapabilities(isProducer, stream);
    } else {
      goCreateTransport(isProducer, stream);
    }
  };

  const getRtpCapabilities = (isProducer, stream) => {
    socket.emit("createRoom", (data) => {
      setRtpCapabilities(data.rtpCapabilities);
      createDevice(isProducer, stream, data.rtpCapabilities);
    });
  };

  const createDevice = async (isProducer, stream, rtpCapabilities) => {
    try {
      const newDevice = new mediasoupClient.Device();
      await newDevice.load({ routerRtpCapabilities: rtpCapabilities });
      setDevice(newDevice);
      goCreateTransport(isProducer, stream);
    } catch (error) {
      console.error("Error creating device:", error);
    }
  };

  const goCreateTransport = (isProducer, stream) => {
    socket.emit("createWebRtcTransport", { sender: isProducer }, ({ params }) => {
      if (params.error) {
        console.error(params.error);
        return;
      }

      if (isProducer) {
        const sendTransport = device.createSendTransport(params);
        sendTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("transport-connect", { dtlsParameters });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        sendTransport.on("produce", async (parameters, callback, errback) => {
          try {
            await socket.emit("transport-produce", parameters, ({ id }) => {
              callback({ id });
            });
          } catch (error) {
            errback(error);
          }
        });

        const newProducer = sendTransport.produce({ track: stream.getVideoTracks()[0] });
        setProducer(newProducer);
        setProducerTransport(sendTransport);
      } else {
        const recvTransport = device.createRecvTransport(params);
        recvTransport.on("connect", async ({ dtlsParameters }, callback, errback) => {
          try {
            await socket.emit("transport-recv-connect", { dtlsParameters });
            callback();
          } catch (error) {
            errback(error);
          }
        });

        setConsumerTransport(recvTransport);
        connectRecvTransport(recvTransport);
      }
    });
  };

  const connectRecvTransport = async (recvTransport) => {
    socket.emit("consume", { rtpCapabilities: device.rtpCapabilities }, async ({ params }) => {
      if (params.error) {
        console.error("Cannot consume", params.error);
        return;
      }

      const newConsumer = await recvTransport.consume({ ...params });
      setConsumer(newConsumer);
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = new MediaStream([newConsumer.track]);
      }
      socket.emit("consumer-resume");
    });
  };

  return (
    <div className="p-4 flex flex-col gap-4 items-center">
      <h1 className="text-xl font-bold">Mediasoup React Client</h1>
      <div className="flex gap-4">
        <video ref={localVideoRef} autoPlay playsInline className="w-1/2 border rounded-xl" />
        <video ref={remoteVideoRef} autoPlay playsInline className="w-1/2 border rounded-xl" />
      </div>
      <div className="flex gap-4 mt-4">
        <button onClick={getLocalStream}>Start Streaming</button>
        <button onClick={() => goConnect(false)}>Receive Stream</button>
      </div>
    </div>
  );
}