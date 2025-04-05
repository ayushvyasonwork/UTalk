import fs from "fs";
import express from "express";
import path from "path";
import { createServer } from "https";
import { Server } from "socket.io";
import mediasoup from "mediasoup";

const app = express();
const __dirname = path.resolve();

const options = {
    key: fs.readFileSync("./server/ssl/key.pem", "utf-8"),
    cert: fs.readFileSync("./server/ssl/cert.pem", "utf-8"),
};

const httpsServer = createServer(options, app);

const io = new Server(httpsServer, {
    cors: { origin: "*" },
});

app.get("/", (req, res) => {
    res.send("Secure WebSocket server is running!");
});

let worker;
let router;
let producer = null;
let consumer;
let producerTransport;
let consumerTransport;
let transportCreated = 0; // Flag to track if transport is created

const createWorker = async () => {
    console.log("🔧 Creating Mediasoup Worker...");
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    });

    console.log(`✅ Worker created with PID: ${worker.pid}`);

    worker.on("died", (error) => {
        console.error("❌ Mediasoup worker died:", error);
        setTimeout(() => process.exit(1), 2000);
    });

    return worker;
};

createWorker().then((createdWorker) => {
    worker = createdWorker;
});

const mediaCodecs = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 1000 } },
];

io.on("connection", async (socket) => {
    console.log(`📡 Client connected: ${socket.id}`);
    console.log('🔍 Is there an existing producer?', producer !== null);

    socket.emit("connection-success", {
        socketId: socket.id,
        existsProducer: producer !== null
    });

    socket.on("disconnect", () => {
        console.log("📴 Client disconnected:", socket.id);
    });

    socket.on("createRoom", async (callback) => {
        console.log("🏗️ Creating room...");
        if (!router) {
            router = await worker.createRouter({ mediaCodecs });
            console.log(`✅ Router created with ID: ${router.id}`);
        } else {
            console.log("⚠️ Router already exists");
        }
        getRtpCapabilities(callback);
    });

    const getRtpCapabilities = (callback) => {
        console.log("📦 Sending RTP Capabilities");
        const rtpCapabilities = router.rtpCapabilities;
        callback({ rtpCapabilities });
    };

    socket.on("createWebRtcTransport", async ({ sender }, callback) => {
        console.log(`📦 Creating WebRTC Transport | Sender: ${sender}`);
        if ((transportCreated===1 && sender===true )|| (transportCreated===2 && sender===false)) {
            console.log("⚠️ Transport already created, skipping...");
            
            return; // Skip if transport is already created
        }

         // Mark transport as created

        if (sender) {
            transportCreated = 1;
            producerTransport = await createWebRtcTransportt(callback);
        } else {
          transportCreated=2;
            consumerTransport = await createWebRtcTransportt(callback);
        }
    });

    socket.on("transport-connect", async ({ dtlsParameters }) => {
        console.log("🔗 Connecting Producer Transport with DTLS parameters:", dtlsParameters);
        await producerTransport.connect({ dtlsParameters });
        console.log("✅ Producer transport connected");
    });

    socket.on("transport-produce", async ({ kind, rtpParameters, appData }, callback) => {
        console.log("🎥 Transport produce requested:", { kind, rtpParameters });

        producer = await producerTransport.produce({
            kind,
            rtpParameters,
        });

        console.log("✅ Producer created with ID:", producer.id);

        producer.on("transportclose", () => {
            console.log("❌ Transport for producer closed");
            producer.close();
        });

        callback({ id: producer.id });
    });

    socket.on("transport-recv-connect", async ({ dtlsParameters }) => {
        console.log("🔗 Connecting Consumer Transport with DTLS parameters:", dtlsParameters);
        await consumerTransport.connect({ dtlsParameters });
        console.log("✅ Consumer transport connected");
    });

    socket.on("consume", async ({ rtpCapabilities }, callback) => {
        console.log("📥 Consume request with capabilities:", rtpCapabilities);

        try {
            if (router.canConsume({ producerId: producer.id, rtpCapabilities })) {
                console.log("✅ Router can consume producer");

                consumer = await consumerTransport.consume({
                    producerId: producer.id,
                    rtpCapabilities,
                    paused: true,
                });

                console.log("✅ Consumer created:", consumer.id);

                consumer.on("transportclose", () => {
                    console.log("❌ Consumer transport closed");
                });

                consumer.on("producerclose", () => {
                    console.log("❌ Producer associated with consumer closed");
                });

                const params = {
                    id: consumer.id,
                    producerId: producer.id,
                    kind: consumer.kind,
                    rtpParameters: consumer.rtpParameters,
                };

                console.log("📦 Sending consumer params:", params);
                callback({ params });
            } else {
                throw new Error("Router cannot consume producer");
            }
        } catch (error) {
            console.error("❌ Error in consume:", error.message);
            callback({ params: { error: error.message } });
        }
    });

    socket.on("consumer-resume", async () => {
        console.log("▶️ Resuming consumer");
        await consumer.resume();
    });
});

const createWebRtcTransportt = async (callback) => {
    console.log("🛠️ Creating WebRTC Transport...");
    try {

        const webRtcTransport_options = {
            listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }],
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        };

        const transport = await router.createWebRtcTransport(webRtcTransport_options); 

        console.log(`✅ WebRTC Transport created: ${transport.id}`);
        let conParams={params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters,
        },}
        console.log('in create webrtc transport fun params to be sent are ',conParams);
        callback({
          params: {
              id: transport.id,
              iceParameters: transport.iceParameters,
              iceCandidates: transport.iceCandidates,
              dtlsParameters: transport.dtlsParameters,
          },
      });
        transport.on("dtlsstatechange", (dtlsState) => {
            console.log(`🔄 DTLS state changed: ${dtlsState}`);
            if (dtlsState === "closed") {
                console.log("❌ DTLS state closed, closing transport.");
                transport.close();
            }
        });
        
        transport.on("close", () => console.log("❌ Transport closed"));

        return transport;
    } catch (error) {
        console.error("❌ Error creating WebRTC Transport:", error.message);
        callback({ params: { error: error.message } });
    }
};

httpsServer.listen(5000, () => {
    console.log("🚀 Secure WebSocket server running on https://localhost:5000");
});
