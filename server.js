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
let producer;
let consumer;
let producerTransport;
let consumerTransport;

const createWorker = async () => {
    worker = await mediasoup.createWorker({
        rtcMinPort: 2000,
        rtcMaxPort: 2020,
    });
    console.log(`Worker created with PID: ${worker.pid}`);

    worker.on("died", (error) => {
        console.error("Mediasoup worker died:", error);
        setTimeout(() => process.exit(1), 2000);
    });

    return worker;
};

worker = createWorker();

const mediaCodecs = [
    { kind: "audio", mimeType: "audio/opus", clockRate: 48000, channels: 2 },
    { kind: "video", mimeType: "video/VP8", clockRate: 90000, parameters: { "x-google-start-bitrate": 1000 } },
];

io.on("connection", async (socket) => {
    console.log(`Client connected: ${socket.id}`);
    console.log('value of producer before sending is');
    socket.emit("connection-success", {socketId:socket.id,existsProducer:producer?true:false});
    socket.on("disconnect", () => {
        console.log("Socket disconnected:", socket.id);
    });
    socket.on('createRoom', async (callback) => {
        if (router === undefined) {
          router = await worker.createRouter({ mediaCodecs, })
          console.log(`Router ID: ${router.id}`)
        }
        getRtpCapabilities(callback)
      })
      const getRtpCapabilities = (callback) => {
        const rtpCapabilities = router.rtpCapabilities
        callback({ rtpCapabilities })
      }
    // router = await worker.createRouter({ mediaCodecs });
    // ✅ Respond to RTP Capabilities request
    
    socket.on('createWebRtcTransport',async ({sender},callback)=>{
        console.log( 'is it a sender ',sender);
        if(sender){
            producerTransport=await createWebRtcTransport(callback);
        }
        else{
            consumerTransport=await createWebRtcTransport(callback);
        }
    })
    socket.on('transport-connect', async ({ dtlsParameters }) => {
        console.log('DTLS PARAMS... ', { dtlsParameters })
        await producerTransport.connect({ dtlsParameters })
      })
      socket.on('transport-produce', async ({ kind, rtpParameters, appData }, callback) => {
        // call produce based on the prameters from the client
        producer = await producerTransport.produce({
          kind,
          rtpParameters,
        })
    
        console.log('Producer ID: ', producer.id, producer.kind)
    
        producer.on('transportclose', () => {
          console.log('transport for this producer closed ')
          producer.close()
        })
    
        // Send back to the client the Producer's id
        callback({
          id: producer.id
        })
      })
      socket.on('transport-recv-connect', async ({ dtlsParameters }) => {
        console.log(`DTLS PARAMS: ${dtlsParameters}`)
        await consumerTransport.connect({ dtlsParameters })
      })
    
      socket.on('consume', async ({ rtpCapabilities }, callback) => {
        try {
          // check if the router can consume the specified producer
          if (router.canConsume({
            producerId: producer.id,
            rtpCapabilities
          })) {
            // transport can now consume and return a consumer
            consumer = await consumerTransport.consume({
              producerId: producer.id,
              rtpCapabilities,
              paused: true,
            })
    
            consumer.on('transportclose', () => {
              console.log('transport close from consumer')
            })
    
            consumer.on('producerclose', () => {
              console.log('producer of consumer closed')
            })
    
            // from the consumer extract the following params
            // to send back to the Client
            const params = {
              id: consumer.id,
              producerId: producer.id,
              kind: consumer.kind,
              rtpParameters: consumer.rtpParameters,
            }
            console.log('params in backend are ',params)
            // send the parameters to the client
            callback({ params })
          }
        } catch (error) {
          console.log(error.message)
          callback({
            params: {
              error: error
            }
          })
        }
      })
    
      socket.on('consumer-resume', async () => {
        console.log('consumer resume')
        await consumer.resume()
      })
});
const createWebRtcTransport = async (callback) => {
    try {
        const webRtcTransport_options = {
            listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }], // Replace YOUR_PUBLIC_IP
            enableUdp: true,
            enableTcp: true,
            preferUdp: true,
        };

        const transport = await router.createWebRtcTransport(webRtcTransport_options);
        console.log(`✅ WebRTC Transport created: ${transport.id}`);

        transport.on("dtlsstatechange", (dtlsState) => {
            if (dtlsState === "closed") {
                console.log("❌ DTLS state closed, closing transport.");
                transport.close();
            }
        });

        transport.on("close", () => console.log("❌ Transport closed"));

        callback({
            params: {
                id: transport.id,
                iceParameters: transport.iceParameters,
                iceCandidates: transport.iceCandidates,
                dtlsParameters: transport.dtlsParameters,
            },
        });

        return transport;
    } catch (error) {
        console.error("❌ Error creating WebRTC Transport:", error);
        callback({ params: { error: error.message } });
    }
};


httpsServer.listen(5000, () => {
    console.log("Secure WebSocket server running on port 5000");
});
