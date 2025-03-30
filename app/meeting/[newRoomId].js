"use client"
export function Meeting({ roomId }) {
    const videoRef = useRef(null);
    const [isMuted, setIsMuted] = useState(false);
    const [isVideoOff, setIsVideoOff] = useState(false);
    const [isSharing, setIsSharing] = useState(false);
    const socket = useRef(null);

    useEffect(() => {
        socket.current = io('http://localhost:5000');
        socket.current.emit('join-room', roomId);
    }, [roomId]);

    const toggleMute = () => {
        setIsMuted(!isMuted);
    };

    const toggleVideo = () => {
        setIsVideoOff(!isVideoOff);
    };

    const toggleScreenShare = () => {
        setIsSharing(!isSharing);
    };

    return (
        <div className="flex flex-col items-center justify-center h-screen">
            <video ref={videoRef} autoPlay playsInline className="w-full max-w-3xl border" />
            <div className="flex space-x-4 mt-4">
                <button className="px-4 py-2 bg-red-500 text-white rounded" onClick={toggleMute}>
                    {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button className="px-4 py-2 bg-yellow-500 text-white rounded" onClick={toggleVideo}>
                    {isVideoOff ? 'Turn On Video' : 'Turn Off Video'}
                </button>
                <button className="px-4 py-2 bg-purple-500 text-white rounded" onClick={toggleScreenShare}>
                    {isSharing ? 'Stop Sharing' : 'Share Screen'}
                </button>
            </div>
        </div>
    );
}